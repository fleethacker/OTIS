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
                db.execute('CREATE TABLE empty_snapshot (id INTEGER)')
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
