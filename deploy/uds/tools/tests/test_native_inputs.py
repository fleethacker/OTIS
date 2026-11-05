"""Native OIDC deployment gates, tested without a cluster or credentials."""
import base64
import copy
import json
from pathlib import Path
import sys
import unittest
import tempfile

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from deploy import require_secret_keys
from validate import inputs
from smoke import read_session_cookie


class NativeInputTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((TOOLS.parent / 'uds-config.example.yaml').read_text())

    def test_native_example_has_hidden_state_and_no_sqlite_settings(self):
        shared = inputs(self.config)
        self.assertEqual(shared['COMMON']['allowedGroups'], ['/Parse Command/Admin', '/Parse Command/Viewer'])
        self.assertNotIn('journal', shared['SERVER']['intake'])
        self.assertFalse(shared['SERVER']['legacyStorage'])

    def test_old_sqlite_settings_require_explicit_migration(self):
        for field, value in [('journal', '/old/custody.sqlite'), ('max_database_bytes', 123)]:
            bad = copy.deepcopy(self.config)
            bad['shared']['SERVER']['intake'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'snapshot migration'):
                inputs(bad)

    def test_public_loopback_and_unspecified_gateway_overrides_are_rejected(self):
        for value in ['127.0.0.1', '0.0.0.0', '8.8.8.8', '::1', '169.254.1.1']:
            bad = copy.deepcopy(self.config)
            bad['shared']['COMMON']['idpGatewayIp'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'private unicast'):
                inputs(bad)
        for value in ['', '10.43.0.10', '192.168.97.3', 'fd00::10']:
            good = copy.deepcopy(self.config)
            good['shared']['COMMON']['idpGatewayIp'] = value
            inputs(good)

    def test_native_roles_cannot_silently_keep_old_users_group(self):
        self.config['shared']['COMMON']['allowedGroups'] = ['/Parse Command/Users', '/Parse Command/Admin']
        with self.assertRaisesRegex(ValueError, 'Admin and Viewer'):
            inputs(self.config)

    def test_state_and_custody_are_distinct_hidden_indices(self):
        for value in ['public-custody', '.parse-command-state-v1']:
            bad = copy.deepcopy(self.config)
            bad['shared']['SERVER']['intake']['custody_index'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'distinct hidden'):
                inputs(bad)

    def test_generated_client_secret_cannot_replace_retained_credentials(self):
        for name in ['parse-command-sso', 'parse-command-imap']:
            bad = copy.deepcopy(self.config)
            bad['shared']['COMMON']['clientSecretName'] = name
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'must not overwrite'):
                inputs(bad)

    def test_empty_or_wildcard_idp_policy_inputs_are_rejected(self):
        for field, value in [('idpSelector', {}), ('idpSelector', {'app': '*'}), ('idpNamespace', '*'), ('idpPort', 0), ('idpPort', 65536)]:
            bad = copy.deepcopy(self.config)
            bad['shared']['COMMON'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                inputs(bad)

    def test_smoke_cookie_header_rejects_injection_and_accepts_opaque_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cookie'
            path.write_text('parse_command_session=An_opaque-session0123456789\n')
            self.assertEqual(read_session_cookie(path), 'parse_command_session=An_opaque-session0123456789')
            for value in ['Bearer oldtoken', 'parse_command_session=', 'parse_command_session=one;admin=yes', 'parse_command_session=one\nInjected: header']:
                path.write_text(value)
                with self.subTest(value=value), self.assertRaises(ValueError):
                    read_session_cookie(path)

    def test_session_key_size_checks_decoded_binary_and_never_prints_values(self):
        def secret(data):
            return {'data': {'session-key': base64.b64encode(data).decode(), 'ca.pem': base64.b64encode(b'certificate').decode()}}
        require_secret_keys(secret(bytes(range(32))), ['session-key', 'ca.pem'], session_key=True)
        for size in [0, 31, 33, 64]:
            with self.subTest(size=size), self.assertRaises(ValueError):
                require_secret_keys(secret(b'x' * size), ['session-key', 'ca.pem'], session_key=True)
        with self.assertRaises(ValueError):
            require_secret_keys({'data': {'session-key': 'not base64!'}}, ['session-key', 'ca.pem'], session_key=True)


if __name__ == '__main__':
    unittest.main()
