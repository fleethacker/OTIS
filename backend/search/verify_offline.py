#!/usr/bin/env python3
"""Explicit local test: detach the search node, deploy/infer, then restore its network."""
import argparse
import json
import math
import subprocess
import time
import urllib.parse

from deploy import HERE, preflight
from search_config import FUSION, INDEX, INGEST, ROOT, TEMPLATE_PREFIX, parameters


def docker(*args):
    return subprocess.check_output(['docker', *args], cwd=ROOT, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disconnect-node-for-test', action='store_true', required=True)
    parser.parse_args()
    preflight()
    container = docker('compose', 'ps', '-q', 'opensearch').strip()
    info = json.loads(docker('inspect', container))[0]
    networks = info['NetworkSettings']['Networks']
    if set(networks) != {'parse-command_application'}:
        raise RuntimeError('offline_test_requires_the_local_single_network_search_node')
    network = 'parse-command_application'
    aliases = networks[network].get('Aliases') or ['opensearch']
    state = json.loads((HERE / 'state/deployment.json').read_text())
    model_id = urllib.parse.quote(state['model_id'], safe='')

    def local(method, path, body=None):
        args = ['exec', container, 'curl', '--silent', '--show-error', '--max-time', '20',
                '--request', method, '--header', 'Content-Type: application/json']
        if body is not None:
            args += ['--data-binary', json.dumps(body)]
        result = docker(*args, '--write-out', '\n%{http_code}', 'http://127.0.0.1:9200' + path)
        text, status = result.rsplit('\n', 1)
        return int(status), json.loads(text)

    docker('network', 'disconnect', network, container)
    try:
        # Deployment reads local model chunks and packaged native dependencies.
        status, result = local('POST', '/_plugins/_ml/models/' + model_id + '/_deploy', {})
        if status >= 400 and 'already deployed' not in json.dumps(result).lower():
            raise RuntimeError('offline_deploy_http_' + str(status))
        if 'task_id' in result:
            for _ in range(120):
                status, task = local('GET', '/_plugins/_ml/tasks/' + result['task_id'])
                if status != 200 or task.get('state') in ('FAILED', 'COMPLETED_WITH_ERROR'):
                    raise RuntimeError('offline_deploy_failed')
                if task.get('state') == 'COMPLETED':
                    break
                time.sleep(1)
            else:
                raise RuntimeError('offline_deploy_deadline')
        status, result = local('POST', '/_ingest/pipeline/' + INGEST + '/_simulate', {
            'docs': [{'_index': INDEX, '_id': 'offline-probe', '_source': {
                'text': 'Coordinate a communications handover and reporting window.'}}]})
        source = result['docs'][0]['doc']['_source']
        vector = source.get('embedding', [])
        if status != 200 or source.get('embedding_status') != 'ready' or len(vector) != 384 or not all(
            math.isfinite(value) for value in vector
        ):
            raise RuntimeError('offline_inference_failed')
        status, result = local('POST', '/' + INDEX + '/_search/template?search_pipeline=' + FUSION +
                               '&allow_partial_search_results=false', {
                                   'id': TEMPLATE_PREFIX + 'hybrid-v1',
                                   'params': parameters('communications handover')})
        if status != 200 or result.get('timed_out') or not result['hits']['hits']:
            raise RuntimeError('offline_hybrid_search_failed')
        print(json.dumps({'node_external_networks': 0, 'vector_dimensions': 384,
                          'hybrid_hits': len(result['hits']['hits']), 'offline_inference': 'passed'}))
    finally:
        args = ['network', 'connect']
        for alias in aliases:
            args += ['--alias', alias]
        docker(*args, network, container)


if __name__ == '__main__':
    main()
