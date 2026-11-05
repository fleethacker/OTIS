import copy
import unittest
from unittest import mock
import migrate_routing
from migrate_routing import binding, validate_records
from migrate_state import identity, record


class RetainedRoutingTests(unittest.TestCase):
    def projection(self, commands):
        return {'kind': 'projection', 'key': 'synthetic@r1', 'source': 'synthetic@r1', 'payload': {'core': {'id': 'synthetic', 'revision': 'r1', 'command_ids': commands}, 'audits': []}}

    def test_only_proven_unrouted_core_gets_default_binding(self):
        self.assertEqual(validate_records([self.projection([])], 'r1')['projections'], 1)
        self.assertEqual(binding('r1')['payload']['commandIds'], [])
        for commands in [None, ['SHIP-A']]:
            with self.assertRaisesRegex(ValueError, 'command IDs'):
                validate_records([self.projection(commands)], 'r1')

    def test_demo_or_source_evidence_cannot_be_rebound_as_unrouted(self):
        for kind in ['demo_command_assignment', 'source_routing_applied']:
            core = self.projection([])
            core['payload']['audits'] = [{'kind': kind, 'revision': 'r1'}]
            with self.assertRaisesRegex(ValueError, 'audit evidence'):
                validate_records([core], 'r1')
            receipt = {'kind': 'receipt', 'source': 'synthetic@r1', 'payload': {'audit': [{'kind': kind, 'revision': 'r1'}]}}
            with self.assertRaisesRegex(ValueError, 'audit evidence'):
                validate_records([self.projection([]), receipt], 'r1')

    def test_unknown_or_inconsistent_revisions_fail(self):
        with self.assertRaisesRegex(ValueError, 'No retained'):
            validate_records([self.projection([])], 'unknown')
        row = self.projection([]);row['source'] = 'different@r1'
        with self.assertRaisesRegex(ValueError, 'inconsistent'):
            validate_records([row], 'r1')
        with self.assertRaisesRegex(ValueError, 'Invalid interpretation'):
            binding('r*')


class WriterLeaseTests(unittest.TestCase):
    def lease(self, available=2030):
        return record('server_lease', 'application', {'token': 'a' * 64}, available=available)

    def test_real_server_deadline_blocks_dry_run_and_apply_before_any_write(self):
        index = '.parse-command-test-active-writer'
        active = self.lease()
        self.assertEqual(active['expires'], 0)
        class Target:
            def __init__(self):
                self.calls = []
            def request(self, method, path, data=None, content='application/json'):
                self.calls.append((method, path))
                if method == 'GET' and path == '/' + index:
                    return 200, {index: {'settings': {'index': {'hidden': 'true'}}}}
                if method == 'GET' and path == '/' + index + '/_doc/' + identity('server_lease', 'application'):
                    return 200, {'found': True, '_source': copy.deepcopy(active)}
                raise AssertionError('Active writer must prevent all scanning or mutation')
        for extra in [[], ['--apply']]:
            target = Target()
            args = ['migrate_routing.py', '--custody-index', index, '--revision', 'r1'] + extra
            with self.subTest(mode=extra), mock.patch('migrate_routing.Target', return_value=target), mock.patch('sys.argv', args), mock.patch('migrate_routing.time.time', return_value=2000):
                with self.assertRaisesRegex(ValueError, 'Stop the application writer'):
                    migrate_routing.main()
                self.assertEqual(len(target.calls), 2)
                self.assertTrue(all(method == 'GET' for method, _ in target.calls))

    def test_expired_available_is_authoritative_and_absent_lease_is_allowed(self):
        expired = self.lease(1999)
        expired['expires'] = 999999
        for lease in [None, expired, self.lease(2000)]:
            with self.subTest(lease=lease), mock.patch('migrate_routing.get_record', return_value=lease), mock.patch('migrate_routing.time.time', return_value=2000):
                migrate_routing.stopped(object(), '.parse-command-test')

    def test_malformed_existing_lease_fails_closed(self):
        malformed = [{}, [], dict(self.lease(), kind='wrong'), dict(self.lease(), key='wrong'), dict(self.lease(), payload={}), dict(self.lease(), payload={'token': None})]
        for deadline in [None, '2030', True, 2030.0, 0, -1, 2**63]:
            malformed.append(dict(self.lease(), available=deadline))
        missing = self.lease();del missing['available'];malformed.append(missing)
        for lease in malformed:
            with self.subTest(lease=lease), mock.patch('migrate_routing.get_record', return_value=lease), mock.patch('migrate_routing.time.time', return_value=2000):
                with self.assertRaisesRegex(ValueError, 'Malformed server lease'):
                    migrate_routing.stopped(object(), '.parse-command-test')


if __name__ == '__main__':
    unittest.main()
