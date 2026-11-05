"""Versioned local search configuration; no source traffic or model bytes."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX = 'parse-command-search-passages-minilm-v1'
ALIAS = 'parse-command-search-passages'
INGEST = 'parse-command-embed-minilm-v1'
FUSION = 'parse-command-hybrid-rrf-v1'
CHUNKER = 'narrative-wordpiece-240-overlap24-v1'
TEMPLATE_PREFIX = 'parse-command-passages-'


def index_definition(model_id, model_hash):
    result = json.loads((ROOT / 'docs/opensearch/passages.ui-index.json').read_text())
    result['aliases'] = {ALIAS: {}}
    result['settings'] = {
        'number_of_shards': 1, 'number_of_replicas': 0, 'index.knn': True,
        'index.default_pipeline': INGEST,
    }
    result['mappings']['_meta'] = {
        'icd_version': '1.2.0', 'profile': 'local_search_test_no_retention',
        'model_id': model_id, 'model_sha256': model_hash, 'chunker': CHUNKER,
    }
    result['mappings']['properties']['embedding'] = {
        'type': 'knn_vector', 'dimension': 384,
        'method': {'name': 'hnsw', 'engine': 'lucene', 'space_type': 'cosinesimil',
                   'parameters': {'m': 16, 'ef_construction': 100}},
    }
    return result


def ingest_pipeline(model_id):
    # Invalid input fails before inference. Inference failure preserves text.
    failure = [
        {'remove': {'field': 'embedding', 'ignore_missing': True}},
        {'set': {'field': 'embedding_status', 'value': 'failed'}},
    ]
    return {
        'description': 'Local MiniLM ONNX inference; text survives inference failure',
        'processors': [
            {'fail': {'if': "ctx.text == null || ctx.text.trim().length() == 0",
                      'message': 'passage_text_required'}},
            {'remove': {'field': 'embedding', 'ignore_missing': True}},
            {'set': {'field': 'embedding_status', 'value': 'pending'}},
            {'text_embedding': {'model_id': model_id, 'field_map': {'text': 'embedding'},
                                'batch_size': 1, 'skip_existing': True, 'on_failure': failure}},
            {'script': {'if': "ctx.embedding_status != 'failed'", 'source':
                "if (ctx.embedding == null || ctx.embedding.size() != 384) { throw new IllegalArgumentException('embedding_dimension'); } ctx.embedding_status = 'ready';",
                'on_failure': failure}},
        ],
    }


def fusion_pipeline():
    return {'description': 'Initial equal-weight reciprocal rank fusion; relevance not yet tuned',
            'phase_results_processors': [{'score-ranker-processor': {
                'combination': {'technique': 'rrf', 'rank_constant': 60}}}]}


FILTERS = '''[
{{#has_command_ids}}{"terms":{"command_ids":{{#toJson}}command_ids{{/toJson}}}},{{/has_command_ids}}
{{#has_types}}{"terms":{"type":{{#toJson}}types{{/toJson}}}},{{/has_types}}
{{#has_classifications}}{"terms":{"security.classification":{{#toJson}}classifications{{/toJson}}}},{{/has_classifications}}
{{#issued_from}}{"range":{"issued_at":{"gte":"{{issued_from}}"}}},{{/issued_from}}
{{#issued_to}}{"range":{"issued_at":{"lt":"{{issued_to}}"}}},{{/issued_to}}
{"match_all":{}}]'''


def templates(model_id):
    lexical = {'multi_match': {'query': '__QUERY__', 'fields': ['text', 'subject'],
                               'type': 'best_fields', 'operator': 'or'}}
    neural = {'neural': {'embedding': {'query_text': '__QUERY__', 'model_id': model_id,
                                      'k': 100, 'filter': '__NEURAL_FILTER__'}}}
    filters = {'bool': {'filter': '__FILTERS__'}}
    ready_filters = {'bool': {'filter': [filters, {'term': {'embedding_status': 'ready'}}]}}
    neural['neural']['embedding']['filter'] = ready_filters
    queries = {
        'keyword': {'bool': {'must': [lexical], 'filter': '__FILTERS__'}},
        'semantic': neural,
        # Same filter in both branches; do not wrap hybrid inside a bool query.
        'hybrid': {'hybrid': {'queries': [
            {'bool': {'must': [lexical], 'filter': '__FILTERS__'}}, copy.deepcopy(neural)]}},
    }
    sources = ['id', 'message_id', 'revision', 'ordinal', 'type', 'originator',
               'issued_at', 'expires_at', 'security', 'command_ids', 'mentioned_units',
               'subject', 'text', 'embedding_status']
    result = {}
    for mode, query in queries.items():
        body = {'size': 20, 'timeout': '5s', 'track_total_hits': False,
                '_source': sources, 'query': query}
        source = json.dumps(body).replace('"__QUERY__"', '"{{query}}"')
        source = source.replace('"__FILTERS__"', FILTERS)
        result[TEMPLATE_PREFIX + mode + '-v1'] = {'script': {'lang': 'mustache', 'source': source}}
    return result


def parameters(query, **filters):
    """Trusted caller helper: bounds, typed filters and no arbitrary query DSL."""
    if not isinstance(query, str) or not query.strip() or len(query.encode()) > 240:
        raise ValueError('query_must_be_1_to_240_utf8_bytes')
    allowed = {'command_ids', 'types', 'classifications', 'issued_from', 'issued_to'}
    if set(filters) - allowed:
        raise ValueError('unknown_search_parameter')
    params = {'query': query}
    for key in ('command_ids', 'types', 'classifications'):
        values = filters.get(key, [])
        if not isinstance(values, list) or len(values) > 32 or any(
            not isinstance(v, str) or not v.strip() or len(v.encode()) > 256 for v in values
        ):
            raise ValueError('invalid_filter_values')
        params[key] = values
        params['has_' + key] = bool(values)
    from datetime import datetime, timezone
    instants = {}
    for key in ('issued_from', 'issued_to'):
        value = filters.get(key)
        if value is not None:
            if not isinstance(value, str) or not value.endswith('Z'):
                raise ValueError('issue_filter_requires_utc_instant')
            instants[key] = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if instants[key].tzinfo != timezone.utc:
                raise ValueError('issue_filter_requires_utc_instant')
            params[key] = value
    if len(instants) == 2 and instants['issued_from'] >= instants['issued_to']:
        raise ValueError('issue_filter_interval_order')
    return params
