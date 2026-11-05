#!/usr/bin/env python3
"""Bind a retained main-3 OpenSearch revision to its proven unrouted policy.

Stop all application and standalone intake writers first. Dry-run is the default;
--apply repeats the scan, checks the server lease, and only creates a new binding.
Nonempty commands or any routing/demo audit evidence require a separate reviewed
policy migration. Raw email bodies and parser prose are not requested or printed.
"""
import argparse
import json
import re
import time
from migrate_state import Target, digest, encoded, identity, record

KINDS = ['mailbox_identity', 'projection', 'receipt', 'audit_archive', 'publication']
FIELDS = ['kind', 'key', 'source', 'category', 'payload.revision',
          'payload.core.id', 'payload.core.revision', 'payload.core.command_ids',
          'payload.audits.kind', 'payload.audits.revision',
          'payload.audit.kind', 'payload.audit.revision',
          'payload.kind', 'payload.document.id', 'payload.document.kind',
          'payload.document.revision', 'payload.document.command_ids']


def binding(revision):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', revision):
        raise ValueError('Invalid interpretation revision')
    policy = {'policyId': None, 'commandIds': []}
    return record('source_routing_revision', revision,
                  dict(policy, fingerprint=digest(encoded(policy)), demoFixtureAssignments=False))


def validate_records(rows, revision):
    counts = {'mailboxes': 0, 'projections': 0, 'receipts': 0, 'published_documents': 0}
    def check_core(core):
        if core.get('revision') == revision:
            if not isinstance(core.get('id'), str) or core.get('command_ids') != []:
                raise ValueError('Nonempty or unproven retained command IDs require reviewed policy migration')
            return True
        return False
    def check_audit(audit):
        if audit.get('revision') == revision and audit.get('kind') in ('source_routing_applied', 'demo_command_assignment'):
            raise ValueError('Routing/demo audit evidence requires reviewed policy migration')
    for row in rows:
        payload = row.get('payload', {})
        kind = row['kind']
        if kind == 'mailbox_identity' and payload.get('revision') == revision:
            counts['mailboxes'] += 1
        elif kind == 'projection':
            core = payload.get('core', {})
            expected = str(core.get('id', '')) + '@' + str(core.get('revision', ''))
            if row.get('key') != expected or row.get('source') != expected:
                raise ValueError('Retained projection identity is inconsistent')
            if check_core(core):
                counts['projections'] += 1
            for audit in payload.get('audits', []):
                check_audit(audit)
        elif kind == 'receipt':
            if row.get('source', '').endswith('@' + revision):
                counts['receipts'] += 1
            for audit in payload.get('audit', []):
                check_audit(audit)
        elif kind == 'audit_archive':
            check_audit(payload)
        elif kind == 'publication':
            value = payload.get('document', {})
            if row.get('category') == 'message' and check_core(value):
                counts['published_documents'] += 1
            else:
                check_audit(value)
    if not any(counts.values()):
        raise ValueError('No retained records establish this revision')
    return counts


def get_record(target, index, kind, key):
    code, value = target.request('GET', '/' + index + '/_doc/' + identity(kind, key))
    if code == 404:
        return None
    if code != 200 or not value.get('found'):
        raise ValueError('Cannot inspect retained state')
    return value['_source']


def stopped(target, index):
    lease = get_record(target, index, 'server_lease', 'application')
    if lease is None:
        return
    # The Rust worker owns available as its renewed deadline; expires remains
    # zero on a normal server_lease record and is not the writer lease clock.
    if (not isinstance(lease, dict) or lease.get('kind') != 'server_lease'
            or lease.get('key') != 'application'
            or type(lease.get('available')) is not int
            or not 0 < lease['available'] <= 2**63 - 1
            or not isinstance(lease.get('payload'), dict)
            or not isinstance(lease['payload'].get('token'), str)
            or not lease['payload']['token']):
        raise ValueError('Malformed server lease; refusing migration')
    if lease['available'] > int(time.time()):
        raise ValueError('Stop the application writer and wait for its lease to expire')


def inspect(target, index, revision):
    expected = binding(revision)
    if not re.fullmatch(r'\.parse-command-[a-z0-9.-]{1,105}', index):
        raise ValueError('Invalid hidden custody index')
    code, value = target.request('GET', '/' + index)
    if code != 200 or value.get(index, {}).get('settings', {}).get('index', {}).get('hidden') != 'true':
        raise ValueError('Existing hidden custody index required')
    stopped(target, index)
    old = get_record(target, index, 'source_routing_revision', revision)
    if old is not None and old != expected:
        raise ValueError('Existing binding differs; refusing overwrite')
    rows, after = [], None
    while True:
        query = {'size': 10, '_source': FIELDS, 'query': {'terms': {'kind': KINDS}}, 'sort': ['kind', 'key']}
        if after is not None:
            query['search_after'] = after
        code, result = target.request('POST', '/' + index + '/_search', query)
        if code != 200:
            raise ValueError('Cannot inspect retained records')
        hits = result.get('hits', {}).get('hits')
        if not isinstance(hits, list):
            raise ValueError('Invalid custody search response')
        if not hits:
            break
        rows.extend(h['_source'] for h in hits)
        if len(rows) > 200000:
            raise ValueError('Scan exceeds 200000 records; explicit archival review required')
        after = hits[-1]['sort']
    counts = validate_records(rows, revision)
    return {'revision': revision, 'policy': 'unrouted', 'already_bound': old is not None,
            'counts': counts, 'snapshot_sha256': digest(encoded(rows))}, expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:9200')
    parser.add_argument('--custody-index', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    target = Target(args.url)
    report, expected = inspect(target, args.custody_index, args.revision)
    if args.apply:
        code, _ = target.request('POST', '/' + args.custody_index + '/_refresh')
        if code != 200:
            raise ValueError('Cannot refresh custody before proof scan')
        second, _ = inspect(target, args.custody_index, args.revision)
        if report != second:
            raise ValueError('Custody changed during inspection; stop every writer and retry')
        stopped(target, args.custody_index)
        target.import_verify(args.custody_index, [expected])
    report['applied'] = args.apply
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
