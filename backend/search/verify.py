#!/usr/bin/env python3
"""Live contract checks using synthetic records in a disposable local index."""
import copy
import hashlib
import json
import math

from deploy import HERE, preflight, request, tokenizer
from load_narratives import chunks
from search_config import (FUSION, INGEST, TEMPLATE_PREFIX, index_definition,
                           ingest_pipeline, parameters)


def main():
    preflight()
    state = json.loads((HERE / 'state/deployment.json').read_text())
    model_id = state['model_id']
    codec = tokenizer()
    long_text = 'GENTEXT/REMARKS/' + 'communications coordination café 航海 ' * 1000 + 'FINALTAIL//'
    parts = list(chunks(long_text, codec))
    covered = set()
    for start, end, piece in parts:
        assert long_text[start:end] == piece
        assert len(codec.encode(piece).ids) <= 256 and len(piece.encode()) <= 8192
        covered.update(range(start, end))
    assert parts[-1][1] == len(long_text)
    assert all(i in covered for i, c in enumerate(long_text) if not c.isspace())

    bad_model = ingest_pipeline('deliberately-unregistered-verification-model')
    result = request('POST', '/_ingest/pipeline/_simulate', {
        'pipeline': bad_model, 'docs': [{'_index': state['index'], '_id': 'failure-probe', '_source': {'text': 'Retain this text on inference failure.'}}]
    })['docs'][0]['doc']['_source']
    assert result['embedding_status'] == 'failed' and 'embedding' not in result and result['text']
    missing = request('POST', '/_ingest/pipeline/' + INGEST + '/_simulate', {
        'docs': [{'_source': {}}]})['docs'][0]
    assert 'error' in missing

    index = 'parse-command-search-verification-v1'
    definition = index_definition(model_id, state['model_sha256'])
    definition['aliases'] = {}
    # Creation fails if another test owns the name; never erase existing data.
    request('PUT', '/' + index, definition)
    checks = []
    try:
        for name, command, classification, message_type in (
            ('a', 'ALPHA', 'UNCLASSIFIED', 'OPTASK COMMS'),
            ('b', 'BRAVO', 'UNCLASSIFIED', 'OPTASK AAW'),
            ('c', 'ALPHA', 'SECRET', 'OPTASK COMMS'),
        ):
            digest = 'sha256:' + hashlib.sha256(name.encode()).hexdigest()
            document = {'id': digest, 'message_id': digest, 'revision': 'verification-v1',
                        'ordinal': 1, 'type': message_type, 'originator': 'SYNTHETIC',
                        'issued_at': '2026-11-04T00:00:00Z', 'expires_at': None,
                        'security': {'policy': 'US', 'classification': classification,
                                     'release_to': [], 'status': 'unvalidated'},
                        'command_ids': [command], 'mentioned_units': [],
                        'subject': None, 'text': 'Communications handover and radio net coordination.',
                        'embedding_status': 'pending'}
            request('PUT', '/' + index + '/_doc/' + name, document)
        request('POST', '/' + index + '/_refresh')
        for mode in ('keyword', 'semantic', 'hybrid'):
            suffix = '?allow_partial_search_results=false'
            if mode == 'hybrid':
                suffix += '&search_pipeline=' + FUSION
            for label, filters, expected in (
                ('all', {}, 3),
                ('restricted', {'command_ids': ['ALPHA'], 'classifications': ['UNCLASSIFIED'],
                                'types': ['OPTASK COMMS'], 'issued_from': '2026-11-01T00:00:00Z',
                                'issued_to': '2026-12-01T00:00:00Z'}, 1),
                ('no_command', {'command_ids': ['NO-SUCH-COMMAND']}, 0),
                ('no_time', {'issued_from': '2027-01-01T00:00:00Z'}, 0),
            ):
                result = request('POST', '/' + index + '/_search/template' + suffix, {
                    'id': TEMPLATE_PREFIX + mode + '-v1',
                    'params': parameters('communications handover', **filters)})
                assert not result.get('timed_out') and result['_shards']['failed'] == 0
                hits = result['hits']['hits']
                assert len(hits) == expected, (mode, label, len(hits), expected)
                assert all('embedding' not in h['_source'] for h in hits)
                checks.append(mode + ':' + label)
        query = 'radio "},"size":999999,"query":{"match_all":{}}'
        rendered = request('POST', '/_render/template', {
            'id': TEMPLATE_PREFIX + 'keyword-v1', 'params': parameters(query)})['template_output']
        assert rendered['size'] == 20
        assert rendered['query']['bool']['must'][0]['multi_match']['query'] == query
        for rejected in ({'size': 100000}, {'command_ids': 'ALPHA'},
                         {'issued_from': 'today'}, {'types': ['x' * 257]}):
            try:
                parameters('query', **rejected)
            except ValueError:
                pass
            else:
                raise AssertionError('invalid_parameter_accepted')
        print(json.dumps({'checks': checks, 'unicode_long_tail': 'passed',
                          'inference_failure_preserves_text': 'passed',
                          'query_escaping_and_bounds': 'passed',
                          'vector_dimensions': 384}))
    finally:
        request('DELETE', '/' + index)


if __name__ == '__main__':
    main()
