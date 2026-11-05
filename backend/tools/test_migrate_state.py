"""Synthetic regression cases for the read-only SQLite-to-OpenSearch importer."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('migrate_state', Path(__file__).with_name('migrate_state.py'))
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def account(self, **changes):
        value = dict(id='dev-user', issuer='local_demo', subject='dev-user', username='dev-user', display_name='Fictional watchstander', email='demo@invalid', role='user', active=1, created_at='2026-11-01T00:00:00Z', last_login_at='2026-11-05T00:00:00Z', previous_login_at='2026-11-04T00:00:00Z', last_login_sequence=40, last_snapshot_at='2026-11-05T00:00:00Z', station_assignment=None, station_revision=0)
        return dict(value, **changes)

    def projection(self, commands=None):
        return dict(message_id='sha256:' + 'a' * 64, revision='r1', core=json.dumps(dict(id='sha256:' + 'a' * 64, revision='r1', command_ids=commands or [])))

    def available(self, **changes):
        value = dict(message_id='sha256:' + 'a' * 64, revision='r1', sequence=3, available_at='2026-11-05T00:00:00Z', subject='Fictional watch', type='OPTASK GENERAL', originator='FICTIONAL', issued_at=None, command_ids='["SHIP-A"]')
        return dict(value, **changes)

    def test_unknown_tables_fail_before_any_target_writes(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported private tables'):
            migration.convert({'new_unhandled_state': []}, {})
        with self.assertRaisesRegex(ValueError, 'Unsupported custody tables'):
            migration.convert({}, {'new_custody_metadata': [{'value': 1}]})

    def test_local_accounts_keep_station_settings_history_and_disabled_state(self):
        assignment = dict(shipName='Fictional Ship', commandIds=['SHIP-A'], department='Engineering', watchStation='Duty', responsibilityIds=['engineering'], includeUnassigned=False, revision=2, source='administrator')
        settings = dict(timezone='UTC', calendarRefreshSeconds=60, defaultCalendarView='week', messageScope=dict(allCommands=False, commandIds=['SHIP-A'], includeUnassigned=False, responsibilityIds=['engineering']))
        private = {'accounts': [self.account(active=0, station_assignment=json.dumps(assignment), station_revision=2)], 'account_settings': [dict(user_id='dev-user', document=json.dumps(settings))], 'responsibility_profiles': [dict(id='engineering', name='Engineering', kind='department', message_types='["OPTASK GENERAL"]')], 'account_audit': [dict(id=1, actor='dev-admin', target='dev-user', kind='station_assignment_updated', detail=json.dumps(assignment), recorded_at='2026-11-05T00:00:00Z')], 'watch_context': [dict(singleton=1, document='{"context":{"shipName":"Fictional Ship"}}')]}
        state, queue = migration.convert(private, {})
        records = {(r['kind'], r['key']): r for r in state}
        user = records['user', 'demo:dev-user']
        self.assertEqual(user['category'], 'viewer')
        self.assertFalse(user['payload']['enabled'])
        self.assertEqual(user['payload']['stationAssignment'], assignment)
        self.assertEqual(user['payload']['accountSettings'], settings)
        self.assertEqual(user['payload']['briefingCheckpoint'], 40)
        self.assertEqual(user['payload']['previous_login'], '2026-11-04T00:00:00Z')
        self.assertEqual(records['responsibility', 'engineering']['payload']['messageTypes'], ['OPTASK GENERAL'])
        self.assertEqual(records['account_audit', '1']['owner'], 'demo:dev-user')
        self.assertEqual(records['watch_context', 'shared']['payload']['context']['shipName'], 'Fictional Ship')
        self.assertEqual(next(r for r in queue if r['kind'] == 'availability_log')['payload']['next'], 40)
        self.assertEqual(migration.convert(private, {}), (state, queue))

    def test_account_without_saved_settings_gets_complete_native_defaults(self):
        state, _ = migration.convert({'accounts': [self.account()]}, {})
        user = next(r for r in state if r['kind'] == 'user')
        self.assertEqual(user['payload']['accountSettings']['calendarRefreshSeconds'], 30)
        self.assertEqual(user['payload']['accountSettings']['messageScope']['allCommands'], True)

    def test_provider_identities_and_ambiguous_timezones_require_mapping(self):
        with self.assertRaisesRegex(ValueError, 'provider identity'):
            migration.convert({'accounts': [self.account(issuer='https://issuer.invalid', subject='immutable-subject')]}, {})
        with self.assertRaisesRegex(ValueError, 'IANA timezone'):
            migration.convert({'accounts': [self.account()], 'account_settings': [dict(user_id='dev-user', document='{"timezone":"local"}')]}, {})

    def test_unrouted_revisions_bind_only_unrouted_projections(self):
        rows = list(migration.routing_records({'projections': [self.projection()]}))
        self.assertEqual(rows[0]['payload']['commandIds'], [])
        self.assertFalse(rows[0]['payload']['demoFixtureAssignments'])
        with self.assertRaisesRegex(ValueError, 'disagrees'):
            list(migration.routing_records({'projections': [self.projection(['SHIP-A'])]}))

    def test_explicit_policy_is_preserved_and_mismatched_projection_fails(self):
        policy = dict(policyId='approved-v1', commandIds=['SHIP-A'])
        old = dict(revision='r1', fingerprint=migration.digest(migration.encoded(policy)), policy_id='approved-v1', command_ids='["SHIP-A"]')
        source = {'source_routing_revisions': [old], 'projections': [self.projection(['SHIP-A'])]}
        binding = list(migration.routing_records(source))[0]
        self.assertEqual(binding['payload']['fingerprint'], old['fingerprint'])
        source['projections'] = [self.projection(['SHIP-B'])]
        with self.assertRaisesRegex(ValueError, 'disagrees'):
            list(migration.routing_records(source))

    def test_demo_binding_needs_exact_catalog_evidence(self):
        catalog = json.loads((Path(__file__).parents[1] / 'config/watchdesk-demo.json').read_text())
        fixture = next(f for f in catalog['fixtures'] if f['file'] == 'shared.txt')
        body_id = fixture['bodyHashes'][0]
        row = dict(message_id=body_id, revision='demo-r1', core=json.dumps(dict(id=body_id, revision='demo-r1', command_ids=fixture['commandIds'])))
        event = dict(kind='demo_command_assignment', payload=dict(version=catalog['version'], fixture=fixture['file'], command_ids=fixture['commandIds']))
        source = {'projections': [row], 'audit_outbox': [dict(message_id=body_id, revision='demo-r1', document=json.dumps(event))]}
        self.assertTrue(list(migration.routing_records(source))[0]['payload']['demoFixtureAssignments'])
        event['payload']['version'] = 'unverified-older-catalog'
        source['audit_outbox'][0]['document'] = json.dumps(event)
        with self.assertRaisesRegex(ValueError, 'matching retained evidence'):
            list(migration.routing_records(source))

    def test_availability_keeps_first_revision_and_allocator_floor(self):
        first = self.available()
        later = self.available(revision='r2', sequence=9, command_ids='["SHIP-B"]')
        source = {'message_availability': [first], 'message_availability_versions': [first, later], 'publication_events': [dict(sequence=22, stage='audit', code='retrying', message_id=first['message_id'], revision='r2')]}
        record = migration.availability_record({'accounts': [self.account()]}, source)
        self.assertEqual(record['payload']['next'], 40)
        self.assertEqual([r['sequence'] for r in record['payload']['entries']], [3, 9])
        self.assertEqual(record['payload']['entries'][0]['core']['command_ids'], ['SHIP-A'])
        self.assertEqual(record['payload']['entries'][1]['core']['command_ids'], ['SHIP-B'])
        source['message_availability_versions'][0] = self.available(subject='silently replaced')
        with self.assertRaisesRegex(ValueError, 'Conflicting immutable'):
            migration.availability_record({}, source)

    def test_availability_backfill_requires_confirmed_published_document(self):
        row = self.available()
        core = dict(id=row['message_id'], revision=row['revision'], subject='PUBLISHED', type=row['type'], originator=row['originator'], command_ids=['SHIP-A'])
        job = dict(id=row['message_id'] + ':r1', kind='message', source=json.dumps(core), state='published', published_at=row['available_at'])
        event = dict(sequence=4, stage='message', code='publication_succeeded', message_id=row['message_id'], revision='r1', at=row['available_at'])
        source = {'publication_jobs': [job], 'publication_events': [event], 'projections': [dict(core='{"subject":"NEW PENDING PROJECTION"}')]}
        result = migration.availability_record({}, source)
        self.assertEqual(result['payload']['entries'][0]['core']['subject'], 'PUBLISHED')
        job['state'] = 'pending'
        self.assertEqual(migration.availability_record({}, source)['payload']['entries'], [])

    def test_full_custody_conversion_preserves_raw_mail_and_receipt_routing_evidence(self):
        raw = b'From: fictional@example.invalid\r\n\r\nSynthetic retained body'
        body_id = 'sha256:' + 'a' * 64
        receipt = dict(id='receipt-1', account_id='demo-inbox', mailbox='INBOX', validity=1, uid=1, size=len(raw), raw=raw, raw_hash='sha256:' + hashlib.sha256(raw).hexdigest(), received_at='2026-11-05T00:00:00Z', server_received_at='2026-11-05T00:00:00Z', attempts=1, code=None, subject='Fictional', metadata='{}', body_id=body_id, revision='r1', sequence=1, state='parsed')
        policy = dict(policyId='approved-v1', commandIds=['SHIP-A'])
        audit = dict(id='audit-1', message_id=body_id, revision='r1', kind='source_routing_applied', payload=dict(receipt_id='receipt-1', policy_id='approved-v1'))
        source = dict(receipts=[receipt], identity=[dict(account_id='demo-inbox', host='mailserver', port=143, username='inbox@invalid', mailbox='INBOX', revision='r1')], projections=[dict(self.projection(['SHIP-A']), selected_sequence=1, subject_conflict=0, delivery_state='pending')], source_routing_revisions=[dict(revision='r1', fingerprint=migration.digest(migration.encoded(policy)), policy_id='approved-v1', command_ids='["SHIP-A"]')], audit_outbox=[dict(id='audit-1', message_id=body_id, revision='r1', receipt_id='receipt-1', document=json.dumps(audit), delivery_state='pending')])
        _, queue = migration.convert({}, source)
        rows = {(r['kind'], r['key']): r for r in queue}
        retained = rows['receipt', 'receipt-1']['payload']
        self.assertEqual(migration.base64.b64decode(retained['raw']), raw)
        self.assertEqual(retained['audit'], [audit])
        self.assertEqual(retained['audit_state'], 'pending')
        self.assertIn('audit_pending', rows['receipt', 'receipt-1']['flags'])
        self.assertEqual(rows['projection', body_id + '@r1']['payload']['audits'], [])
        self.assertEqual(rows['source_routing_revision', 'r1']['payload']['policyId'], 'approved-v1')
        source['receipts'][0]['raw_hash'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(ValueError, 'Receipt hash mismatch'):
            migration.convert({}, source)

    def test_target_create_only_retry_verifies_and_never_overwrites(self):
        class SyntheticTarget(migration.Target):
            def __init__(self):
                self.documents = {}
            def request(self, method, path, data=None, content='application/json'):
                if path == '/_bulk':
                    lines = data.decode().splitlines()
                    items = []
                    for index in range(0, len(lines), 2):
                        key = json.loads(lines[index])['create']['_id']
                        value = json.loads(lines[index + 1])
                        status = 409 if key in self.documents else 201
                        self.documents.setdefault(key, value)
                        items.append({'create': {'status': status}})
                    return 200, {'items': items}
                if path.endswith('/_mget'):
                    return 200, {'docs': [{'_source': self.documents.get(key)} for key in data['ids']]}
                if path.endswith('/_refresh'):
                    return 200, {}
                raise AssertionError('Unexpected target operation')
        target = SyntheticTarget()
        expected = migration.record('user', 'demo:dev-user', {'enabled': False})
        target.import_verify('.parse-command-test', [expected])
        target.import_verify('.parse-command-test', [expected])
        replacement = migration.record('user', 'demo:dev-user', {'enabled': True})
        with self.assertRaisesRegex(ValueError, 'refusing overwrite'):
            target.import_verify('.parse-command-test', [replacement])
        self.assertEqual(list(target.documents.values()), [expected])

    def test_snapshot_reads_without_changing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE drafts(id INTEGER, owner TEXT, source_key TEXT, text TEXT, saved_at TEXT)')
                db.execute("INSERT INTO drafts VALUES(1,'dev-user','fictional@r1','synthetic','2026-11-05T00:00:00Z')")
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(migration.snapshot(path)['drafts'][0]['owner'], 'dev-user')
            self.assertEqual(before, hashlib.sha256(path.read_bytes()).hexdigest())

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from migrate_state import convert, migrated_owner


class MigrationOwnerTests(unittest.TestCase):
    def test_oidc_preservation_requires_explicit_trust_and_canonical_hash(self):
        owner = 'oidc:' + 'a' * 64
        with self.assertRaisesRegex(ValueError, 'reviewed provenance'):
            migrated_owner(owner)
        self.assertEqual(migrated_owner(owner, True), owner)
        for malformed in ['oidc:alice', 'oidc:' + 'a' * 63, 'OIDC:' + 'a' * 64, 'oidc:' + 'A' * 64]:
            with self.subTest(owner=malformed), self.assertRaisesRegex(ValueError, 'Malformed'):
                migrated_owner(malformed, True)
        self.assertEqual(migrated_owner('dev-admin', True), 'demo:dev-admin')

    def test_private_records_preserve_exact_owner_and_revision_without_role_grant(self):
        alice, bob = 'oidc:' + 'a' * 64, 'oidc:' + 'b' * 64
        source = 'sha256:' + 'c' * 64 + '@revision-1'
        private = {
            'drafts': [dict(id=7, owner=alice, source_key=source, text='Unsent Alice draft', saved_at='2026-11-05T12:00:00Z')],
            'preparations': [dict(owner=bob, source_key=source, fields_json='{"notes":"Bob private"}', generated_text='', acknowledged=False)],
            'activity': [dict(id=8, owner=bob, source_key=source, kind='prepared', recorded_at='2026-11-05T12:00:00Z', occurred_at=None, note='private history')],
            'notification_reads': [dict(owner=alice, notification_id=9, version=2)],
            'notification_inboxes': [dict(owner=bob, read_through=3)],
        }
        with self.assertRaises(ValueError):
            convert(private, {})
        state, _ = convert(private, {}, preserve_oidc=True)
        draft = next(r for r in state if r['kind'] == 'draft')
        self.assertEqual((draft['key'], draft['owner'], draft['source'], draft['payload']['text']),
                         (alice + '\0' + source, alice, source, 'Unsent Alice draft'))
        prep = next(r for r in state if r['kind'] == 'preparation')
        self.assertEqual(prep['owner'], bob)
        self.assertEqual(prep['payload']['history'][0]['recorder'], bob)
        self.assertEqual(prep['payload']['history'][0]['note'], 'private history')
        reads = {r['owner']: r['payload'] for r in state if r['kind'] == 'notification_reads'}
        self.assertEqual(reads[alice]['versions'], {'9': 2})
        self.assertEqual(reads[bob]['through'], 3)
        users = [r for r in state if r['kind'] == 'user']
        self.assertEqual({r['owner'] for r in users}, {alice, bob})
        self.assertTrue(all(r['category'] == 'viewer' and r['payload']['groups'] == []
                            and r['payload']['identity_type'] == 'oidc' for r in users))

    def test_cli_dry_run_requires_opt_in_and_never_changes_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            private, custody = [Path(directory) / name for name in ['private.sqlite', 'custody.sqlite']]
            with sqlite3.connect(private) as db:
                db.execute('CREATE TABLE drafts (id INTEGER, owner TEXT, source_key TEXT, text TEXT, saved_at TEXT)')
                db.execute('INSERT INTO drafts VALUES (1, ?, ?, ?, ?)',
                           ('oidc:' + 'a' * 64, 'source@revision', 'private draft', '2026-11-05T12:00:00Z'))
            with sqlite3.connect(custody) as db:
                db.execute('CREATE TABLE identity (account_id TEXT, host TEXT, port INTEGER, username TEXT, mailbox TEXT, revision TEXT)')
            before = [p.read_bytes() for p in [private, custody]]
            command = [sys.executable, str(Path(__file__).with_name('migrate_state.py')),
                       '--private', str(private), '--custody', str(custody),
                       '--state-index', '.parse-command-test-state', '--custody-index', '.parse-command-test-custody',
                       '--url', 'http://no-network-needed.invalid:9200']
            rejected = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('--preserve-oidc-owners', rejected.stderr)
            accepted = subprocess.run(command + ['--preserve-oidc-owners'], capture_output=True, text=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            report = json.loads(accepted.stdout)
            self.assertEqual(report['owner_policy'], 'preserve_reviewed_oidc')
            self.assertEqual(report['source_counts']['private']['drafts'], 1)
            self.assertEqual(before, [p.read_bytes() for p in [private, custody]])


if __name__ == '__main__':
    unittest.main()
