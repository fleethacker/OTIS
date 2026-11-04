#!/usr/bin/env python3
"""Prepare token-bounded narrative passages from a consistent custody snapshot."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import urllib.error

from deploy import HERE, pin_and_verify, preflight, request, tokenizer
from search_config import ALIAS, CHUNKER, INDEX

AUDIT_INDEX = 'parse-command-intake-test-audit-v1'
NARRATIVE_SETS = {'GENTEXT', 'NARR', 'AMPN'}


def chunks(text, codec):
    """Contiguous source slices; re-encode each slice to verify the actual budget."""
    if len(text.encode()) > 524_288:
        raise ValueError('source_record_limit')
    offsets = codec.encode(text, add_special_tokens=False).offsets
    cursor = 0
    while cursor < len(offsets):
        last = min(cursor + 240, len(offsets))
        start = offsets[cursor][0]
        end = offsets[last - 1][1]
        while last > cursor + 1 and (len(text[start:end].encode()) > 8192 or
                                     len(codec.encode(text[start:end]).ids) > 256):
            last -= 1
            end = offsets[last - 1][1]
        if len(text[start:end].encode()) > 8192:
            # A single unknown token can represent a huge source word. Subdivide
            # that span rather than passing unbounded text to the inference engine.
            piece_start = start
            while piece_start < end:
                piece_end = min(piece_start + 1024, end)
                piece = text[piece_start:piece_end]
                while len(codec.encode(piece).ids) > 256:
                    piece_end = piece_start + max(1, (piece_end - piece_start) // 2)
                    piece = text[piece_start:piece_end]
                yield piece_start, piece_end, piece
                piece_start = piece_end
        else:
            piece = text[start:end]
            if len(codec.encode(piece).ids) > 256:
                raise ValueError('chunk_token_limit')
            yield start, end, piece
        if last == len(offsets):
            break
        cursor = max(cursor + 1, last - 24)


def passages(db, codec):
    for message_id, revision, source in db.execute(
        'SELECT message_id,revision,core FROM projections ORDER BY message_id,revision'
    ):
        core = json.loads(source)
        records, raw = [], None
        for document, in db.execute(
            "SELECT document FROM audit_outbox WHERE json_extract(document,'$.message_id')=? "
            "AND json_extract(document,'$.revision')=?", (message_id, revision)
        ):
            audit = json.loads(document)
            if audit['kind'] == 'source_preserved':
                raw = audit['payload']['source']['raw_text'].encode('utf-8')
            elif audit['kind'] in ('record_interpreted', 'fact_interpreted') and audit['payload']['set_id'] in NARRATIVE_SETS:
                records.append(audit['payload'])
        if raw is None or len(raw) > 524_288 or 'sha256:' + hashlib.sha256(raw).hexdigest() != message_id:
            raise ValueError('source_missing_or_hash_mismatch')
        ordinal = 0
        unique_records = {r['record_sequence']: r for r in records}
        for record in sorted(unique_records.values(), key=lambda r: r['record_sequence']):
            span = record['span']
            left, right = span['start_byte'], span['end_byte']
            if not 0 <= left < right <= len(raw):
                raise ValueError('record_source_span')
            text = raw[left:right].decode('utf-8')
            for start, end, piece in chunks(text, codec):
                ordinal += 1
                if ordinal > 2048:
                    raise ValueError('passages_per_message_limit')
                start_byte = left + len(text[:start].encode())
                end_byte = left + len(text[:end].encode())
                identity = '\0'.join((message_id, revision, CHUNKER, str(start_byte), str(end_byte)))
                passage_id = 'sha256:' + hashlib.sha256(identity.encode()).hexdigest()
                passage = {key: core[key] for key in (
                    'type', 'originator', 'issued_at', 'expires_at', 'security', 'command_ids', 'subject')}
                passage.update(id=passage_id, message_id=message_id, revision=revision,
                               ordinal=ordinal, text=piece, embedding_status='pending', mentioned_units=[])
                audit_id = hashlib.sha256(('passage_prepared\0' + passage_id).encode()).hexdigest()
                audit = {'id': audit_id, 'message_id': message_id, 'revision': revision,
                         'kind': 'passage_prepared',
                         'recorded_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                         'security': core['security'],
                         'payload': {'passage_id': passage_id, 'chunker': CHUNKER, 'set_id': record['set_id'],
                                     'model_sha256': pin_and_verify_cached(),
                                     'span': {'start_byte': start_byte, 'end_byte': end_byte,
                                              'representation': 'decoded_utf8_body'}}}
                if core['issued_at'] is not None:
                    audit['issued_at'] = core['issued_at']
                yield passage, audit


def pin_and_verify_cached():
    # Archive verification is performed once before loading; metadata is small.
    return json.loads((HERE / 'model.json').read_text())['model_content_hash_value']


def write_batch(batch):
    data = bytearray()
    for passage, audit in batch:
        for action, index, document in (('index', INDEX, passage), ('create', AUDIT_INDEX, audit)):
            data.extend((json.dumps({action: {'_index': index, '_id': document['id']}}) + '\n' +
                         json.dumps(document, allow_nan=False) + '\n').encode())
    if len(data) > 2_097_152:
        raise ValueError('bulk_byte_limit')
    result = request('POST', '/_bulk', bytes(data), 'application/x-ndjson')
    if len(result['items']) != 2 * len(batch):
        raise RuntimeError('bulk_response_count')
    for number, (_, audit) in enumerate(batch):
        if result['items'][2 * number]['index']['status'] not in (200, 201):
            raise RuntimeError('passage_bulk_item_failure')
        status = result['items'][2 * number + 1]['create']['status']
        if status in (200, 201):
            continue
        if status != 409:
            raise RuntimeError('audit_bulk_item_failure')
        existing = request('GET', '/' + AUDIT_INDEX + '/_doc/' + audit['id'])['_source']
        # recorded_at is the original preparation time; do not overwrite it.
        existing.pop('recorded_at', None)
        replay = {k: v for k, v in audit.items() if k != 'recorded_at'}
        if existing != replay:
            raise RuntimeError('immutable_passage_audit_conflict')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('journal', type=Path)
    args = parser.parse_args()
    preflight()
    pin_and_verify()
    # Both destinations must exist with explicit mappings before any write.
    request('GET', '/' + INDEX + '/_mapping')
    request('GET', '/' + AUDIT_INDEX + '/_mapping')
    codec = tokenizer()
    with sqlite3.connect(args.journal.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        batch, count = [], 0
        for item in passages(db, codec):
            batch.append(item)
            if len(batch) == 16:
                write_batch(batch)
                count += len(batch)
                batch.clear()
        if batch:
            write_batch(batch)
            count += len(batch)
    request('POST', '/' + INDEX + ',' + AUDIT_INDEX + '/_refresh')
    ready = request('POST', '/' + ALIAS + '/_count', {'query': {'term': {'embedding_status': 'ready'}}})['count']
    failed = request('POST', '/' + ALIAS + '/_count', {'query': {'term': {'embedding_status': 'failed'}}})['count']
    print(json.dumps({'passages_written': count, 'ready': ready, 'failed': failed,
                      'custody_and_runtime_outbox': 'unchanged', 'retention': 'test_only_no_expiry'}))
    if failed or ready != count:
        raise SystemExit('passage_enrichment_incomplete')


if __name__ == '__main__':
    main()
