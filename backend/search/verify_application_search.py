#!/usr/bin/env python3
"""Read-only checks for the deployed application templates and OpenSearch RRF."""
import math
from deploy import preflight, request
from search_config import ALIAS, FUSION


def main():
    preflight()
    pipeline = request('GET', '/_search/pipeline/' + FUSION)[FUSION]
    combination = pipeline['phase_results_processors'][0]['score-ranker-processor']['combination']
    assert combination['technique'] == 'rrf'
    assert combination.get('rank_constant', 60) == 60
    assert combination.get('parameters', {}).get('weights', [.5, .5]) == [.5, .5]
    params = {'query': 'communications', 'filters': [{'match_all': {}}]}
    rendered = request('POST', '/_render/template', {
        'id': 'parse-command-passages-hybrid-v2', 'params': params})['template_output']
    clauses = rendered['query']['hybrid']['queries']
    assert len(clauses) == 2
    assert 'multi_match' in clauses[0]['bool']['must'][0]
    assert 'neural' in clauses[1]
    assert clauses[0]['bool']['filter'] == params['filters']
    assert clauses[1]['neural']['embedding']['filter']['bool']['filter'][0]['bool']['filter'] == params['filters']
    assert rendered['size'] == 100
    results = {}
    for mode in ('keyword', 'semantic', 'hybrid'):
        suffix = '?allow_partial_search_results=false'
        if mode == 'hybrid':
            suffix += '&search_pipeline=' + FUSION
        result = request('POST', '/' + ALIAS + '/_search/template' + suffix, {
            'id': 'parse-command-passages-' + mode + '-v2', 'params': params})
        assert result['_shards']['failed'] == 0 and not result.get('timed_out')
        results[mode] = result['hits']['hits']
        assert results[mode], mode + ': no verification results'
        assert all('embedding' not in hit['_source'] for hit in results[mode])
    ranks = {mode: {hit['_id']: rank for rank, hit in enumerate(results[mode], 1)}
             for mode in ('keyword', 'semantic')}
    # A full candidate window cannot establish the rank of omitted clause hits.
    # Use a more selective query/corpus for this arithmetic check if it grows.
    if any(len(results[mode]) >= 100 for mode in ('keyword', 'semantic')):
        raise RuntimeError('verification_candidate_window_full; narrow verification query')
    for hit in results['hybrid']:
        expected = sum(1 / (60 + ranks[mode][hit['_id']])
                       for mode in ranks if hit['_id'] in ranks[mode])
        assert math.isclose(hit['_score'], expected, rel_tol=1e-5, abs_tol=1e-7), 'RRF score mismatch'
    assert all(a['_score'] >= b['_score'] for a, b in zip(results['hybrid'], results['hybrid'][1:]))
    print('Verified: two-clause BM25 + local semantic query, identical metadata filters,')
    print('OpenSearch RRF rank_constant=60, score arithmetic, descending rank and no vectors in results.')
    print('Clause/result counts:', {mode: len(hits) for mode, hits in results.items()})


if __name__ == '__main__':
    main()
