#!/usr/bin/env python3
"""Bounded reference caller for frontend/backend search integration."""
import argparse
import json

from deploy import preflight, request
from search_config import ALIAS, FUSION, TEMPLATE_PREFIX, parameters


def search(mode, query, **filters):
    if mode not in ('keyword', 'semantic', 'hybrid'):
        raise ValueError('unsupported_search_mode')
    params = parameters(query, **filters)
    suffix = '?allow_partial_search_results=false'
    if mode == 'hybrid':
        suffix += '&search_pipeline=' + FUSION
    result = request('POST', '/' + ALIAS + '/_search/template' + suffix, {
        'id': TEMPLATE_PREFIX + mode + '-v1', 'params': params})
    if result.get('timed_out') or result.get('_shards', {}).get('failed', 0):
        raise RuntimeError('search_incomplete')
    return {'requested_mode': mode, 'executed_mode': mode, 'took_ms': result['took'],
            'page_limit': 20, 'pagination': 'first_page_only',
            'hits': [{'score': hit['_score'], **hit['_source']} for hit in result['hits']['hits']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('keyword', 'semantic', 'hybrid'))
    parser.add_argument('query')
    parser.add_argument('--command', action='append', default=[])
    parser.add_argument('--type', action='append', default=[])
    parser.add_argument('--classification', action='append', default=[])
    parser.add_argument('--issued-from')
    parser.add_argument('--issued-to')
    args = parser.parse_args()
    preflight()
    result = search(args.mode, args.query, command_ids=args.command, types=args.type,
                    classifications=args.classification, issued_from=args.issued_from,
                    issued_to=args.issued_to)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    main()
