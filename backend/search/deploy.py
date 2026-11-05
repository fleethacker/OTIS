#!/usr/bin/env python3
"""Offline-capable local search bootstrap. Public downloads belong to prepare_assets.py."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

from search_config import (ALIAS, FUSION, INDEX, INGEST, ROOT, fusion_pipeline,
                           index_definition, ingest_pipeline, templates)

HERE = Path(__file__).resolve().parent
BASE = os.environ.get('PARSE_COMMAND_OPENSEARCH_URL', 'http://127.0.0.1:9200').rstrip('/')
# Never follow a redirect carrying a bootstrap mutation to another endpoint.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('bootstrap_redirect_rejected')
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def request(method, path, body=None, content_type='application/json'):
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body, allow_nan=False).encode()
    req = urllib.request.Request(BASE + path, data=body, method=method,
                                 headers={'Content-Type': content_type})
    # A rejected chunk must resume at the same deterministic number. Restarting
    # the entire upload on transient heap pressure repeats already stored chunks.
    # Retry only an explicit HTTP 429 rejection, never an ambiguous connection
    # failure that may have committed a non-idempotent model/task request.
    for attempt in range(6):
        try:
            with OPENER.open(req, timeout=60) as response:
                data = response.read(8_388_609)
                if len(data) > 8_388_608:
                    raise RuntimeError('response_limit')
                return json.loads(data)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 5:
                raise
            error.close()
            time.sleep(min(2 ** (attempt + 1), 16))


def preflight():
    info = request('GET', '/')
    health = request('GET', '/_cluster/health')
    if info['version']['number'] != '3.9.0' or health['status'] not in ('green', 'yellow'):
        raise RuntimeError('requires_ready_opensearch_3_9_0')


def tokenizer():
    import zipfile
    from tokenizers import Tokenizer
    with zipfile.ZipFile(HERE / 'assets/model.zip') as archive:
        names = [n for n in archive.namelist() if n.rsplit('/', 1)[-1] == 'tokenizer.json']
        if len(names) != 1 or archive.getinfo(names[0]).file_size > 4_194_304:
            raise RuntimeError('tokenizer_archive_layout')
        result = Tokenizer.from_str(archive.read(names[0]).decode())
    result.no_truncation()
    result.no_padding()
    return result


def pin_and_verify():
    pin = json.loads((HERE / 'model.json').read_text())
    path = HERE / 'assets/model.zip'
    if path.stat().st_size != pin['model_content_size_in_bytes']:
        raise RuntimeError('archive_size_mismatch')
    digest = hashlib.sha256()
    with path.open('rb') as archive:
        for chunk in iter(lambda: archive.read(1_048_576), b''):
            digest.update(chunk)
    if digest.hexdigest() != pin['model_content_hash_value']:
        raise RuntimeError('archive_checksum_mismatch')
    return pin


def await_task(task_id):
    for _ in range(120):
        task = request('GET', '/_plugins/_ml/tasks/' + urllib.parse.quote(task_id, safe=''))
        if task['state'] == 'COMPLETED':
            return task
        if task['state'] in ('FAILED', 'COMPLETED_WITH_ERROR', 'CANCELLED'):
            raise RuntimeError('model_task_failed: ' + json.dumps(task.get('error', 'unknown'))[:2000])
        time.sleep(1)
    raise RuntimeError('model_task_deadline')


def ensure_model(pin):
    name = 'parse-command-minilm-384-v1'
    hits = request('POST', '/_plugins/_ml/models/_search', {
        'size': 10, 'query': {'bool': {'filter': [
            {'match_phrase': {'name': name}}, {'exists': {'field': 'model_config'}}]}}})['hits']['hits']
    hits = [hit for hit in hits if hit['_source'].get('name') == name]
    if len(hits) > 1:
        raise RuntimeError('ambiguous_model_registration')
    if hits:
        model_id = hits[0]['_id']
        if hits[0]['_source'].get('model_content_hash_value') != pin['model_content_hash_value']:
            raise RuntimeError('registered_model_hash_conflict')
    else:
        # Upload bounded binary chunks: no URL registration or public fetch.
        chunk_size = 2_000_000
        metadata = {key: pin[key] for key in (
            'version', 'model_format', 'model_config', 'model_content_hash_value',
            'model_content_size_in_bytes')}
        metadata.update(name=name, function_name='TEXT_EMBEDDING',
                        total_chunks=math.ceil(pin['model_content_size_in_bytes'] / chunk_size))
        model_id = request('POST', '/_plugins/_ml/models/_register_meta', metadata)['model_id']
    state = request('GET', '/_plugins/_ml/models/' + model_id)
    if state.get('model_state') == 'REGISTERING':
        # Deterministic chunk numbers permit retrying an interrupted local upload.
        chunk_size = 2_000_000
        with (HERE / 'assets/model.zip').open('rb') as archive:
            for number in range(math.ceil(pin['model_content_size_in_bytes'] / chunk_size)):
                request('POST', '/_plugins/_ml/models/' + model_id + '/upload_chunk/' + str(number),
                        archive.read(chunk_size))
        state = request('GET', '/_plugins/_ml/models/' + model_id)
    if state.get('model_state') != 'DEPLOYED':
        task = request('POST', '/_plugins/_ml/models/' + model_id + '/_deploy', {})
        await_task(task['task_id'])
    return model_id


def compatible_mapping_upgrade(current, expected):
    """Only additive ICD metadata/fields; model and vector geometry stay pinned."""
    meta = current.get('_meta', {})
    target = expected['_meta']
    pinned = (meta.get('profile') == target['profile']
              and meta.get('model_sha256') == target['model_sha256']
              and meta.get('chunker') == target['chunker'])
    runtime = (meta.get('profile') == 'ui_fixture_lexical_no_retention'
               and not any(key in meta for key in ('model_sha256', 'model_id', 'chunker')))
    if (meta.get('icd_version') not in ('1.1.0', '1.2.0') or not (pinned or runtime)
            or current.get('properties', {}).get('embedding') != expected['properties']['embedding']):
        raise RuntimeError('index_model_or_chunker_conflict_new_generation_required')
    return {'_meta': {**meta, **target},
            'properties': {'casualty': expected['properties']['casualty']}}


def deploy():
    preflight()
    pin = pin_and_verify()
    request('PUT', '/_cluster/settings', {'persistent': {
        'plugins.ml_commons.only_run_on_ml_node': False,
    }})
    request('PUT', '/_cluster/settings', {'persistent': {
        'plugins.ml_commons.allow_registering_model_via_local_file': True,
    }})
    try:
        model_id = ensure_model(pin)
    finally:
        request('PUT', '/_cluster/settings', {'persistent': {
            'plugins.ml_commons.allow_registering_model_via_local_file': False,
        }})
    request('PUT', '/_ingest/pipeline/' + INGEST, ingest_pipeline(model_id))
    request('PUT', '/_search/pipeline/' + FUSION, fusion_pipeline())
    expected = index_definition(model_id, pin['model_content_hash_value'])
    try:
        existing = request('GET', '/' + INDEX)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        request('PUT', '/' + INDEX, expected)
    else:
        upgrade = compatible_mapping_upgrade(existing[INDEX]['mappings'], expected['mappings'])
        request('PUT', '/' + INDEX + '/_mapping', upgrade)
    for name, body in templates(model_id).items():
        request('PUT', '/_scripts/' + name, body)
    # Persisted DEPLOYED metadata can outlive the process-local inference cache.
    # Check real inference, request a bounded redeploy on failure, and wait for warmup.
    ready = False
    for attempt in range(120):
        sample = {'text': 'Coordinate the communications plan and reporting requirements.'}
        response = request('POST', '/_ingest/pipeline/' + INGEST + '/_simulate', {
            'docs': [{'_index': INDEX, '_id': 'bootstrap-probe', '_source': sample}]})
        result = response['docs'][0].get('doc', {}).get('_source', {})
        vector = result.get('embedding', [])
        ready = (result.get('embedding_status') == 'ready' and len(vector) == 384
                 and all(type(x) in (float, int) and math.isfinite(x) for x in vector))
        if ready:
            break
        if attempt == 0:
            task = request('POST', '/_plugins/_ml/models/' + model_id + '/_deploy', {})
            await_task(task['task_id'])
        time.sleep(1)
    if not ready:
        raise RuntimeError('local_inference_not_ready_after_redeploy_deadline')
    state_dir = Path(os.environ.get('PARSE_COMMAND_SEARCH_STATE', str(HERE / 'state')))
    state_dir.mkdir(parents=True, exist_ok=True)
    state = {'model_id': model_id, 'model_sha256': pin['model_content_hash_value'],
             'dimension': 384, 'index': INDEX, 'alias': ALIAS,
             'ingest_pipeline': INGEST, 'search_pipeline': FUSION,
             'templates': list(templates(model_id))}
    (state_dir / 'deployment.json').write_text(json.dumps(state, indent=2) + '\n')
    print(json.dumps({**state, 'actual_inference': 'ready'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        deploy()
    except urllib.error.HTTPError as error:
        # Bootstrap sends only configuration/synthetic probe text, never source traffic.
        print(error.read(4096).decode(errors='replace'))
        raise SystemExit('search_bootstrap_http_error: ' + str(error.code))
