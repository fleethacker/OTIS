"""Check deployment identity/routing inputs without a cluster or credentials."""
import copy
import json
from pathlib import Path
import sys
import unittest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from validate import inputs, required_secrets
from smoke import validate_origin, validate_session


class IdentityInputsTests(unittest.TestCase):
    def config(self):
        return json.loads((TOOLS.parent / 'uds-config.example.yaml').read_text())

    def test_no_routing_is_the_default_and_approved_source_policy_is_explicit(self):
        config = self.config()
        self.assertIsNone(inputs(config)['SERVER']['intake'].get('sourceRouting'))
        expected = {'policyId': 'approved-feed-v1', 'commandIds': ['SHIP-A']}
        config['shared']['SERVER']['intake']['sourceRouting'] = expected
        self.assertEqual(inputs(config)['SERVER']['intake']['sourceRouting'], expected)

    def test_invalid_or_inferred_source_policies_are_rejected(self):
        for policy in [
            {'policyId': 'p', 'commandIds': [], 'inferFromContacts': True},
            {'policyId': 'p', 'commandIds': []},
            {'policyId': 'bad policy', 'commandIds': ['SHIP-A']},
            {'policyId': 'p', 'commandIds': ['SHIP-A', 'SHIP-A']},
            {'policyId': 'p', 'commandIds': [' SHIP-A']},
            {'policyId': 'p', 'commandIds': ['SHIP\nA']},
            {'policyId': 'p', 'commandIds': ['x' * 257]},
            {'policyId': 'p', 'commandIds': [f'SHIP-{i}' for i in range(33)]},
        ]:
            config = copy.deepcopy(self.config())
            config['shared']['SERVER']['intake']['sourceRouting'] = policy
            with self.subTest(policy=policy), self.assertRaisesRegex(ValueError, 'sourceRouting'):
                inputs(config)

    def test_source_routing_does_not_relax_verified_mail_tls(self):
        config = self.config()
        config['shared']['SERVER']['intake']['sourceRouting'] = {
            'policyId': 'approved-feed-v1', 'commandIds': ['SHIP-A']}
        config['shared']['SERVER']['intake']['transport'] = 'plaintext_demo'
        with self.assertRaisesRegex(ValueError, 'TLS'):
            inputs(config)

    def test_native_identity_and_hidden_storage_inputs(self):
        config = self.config()
        self.assertIn(('parse-command-sso', ['session-key', 'ca.pem']), required_secrets(inputs(config)))
        for field in ['sessionTtlSeconds', 'oidcPolicySecret', 'oidcPolicy', 'oidcKeySecret']:
            invalid = copy.deepcopy(config)
            invalid['shared']['SERVER'][field] = 'obsolete'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'obsolete'):
                inputs(invalid)
        config['shared']['COMMON']['idpPort'] = 8443
        self.assertEqual(inputs(config)['COMMON']['idpPort'], 8443)
        config['shared']['SERVER']['viewerGroup'] = config['shared']['SERVER']['adminGroup']
        with self.assertRaisesRegex(ValueError, 'distinct'):
            inputs(config)
        config = self.config()
        config['shared']['SERVER']['intake']['journal'] = '/data/custody.sqlite'
        with self.assertRaisesRegex(ValueError, 'snapshot migration'):
            inputs(config)

    def test_smoke_requires_exact_origin_and_station_before_sending_mail(self):
        self.assertEqual(validate_origin('https://parse.example/'), 'https://parse.example')
        for origin in ['http://parse.example', 'https://user:secret@parse.example',
                       'https://parse.example/path', 'https://parse.example?query=1']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                validate_origin(origin)
        session = {'authenticated': True, 'authMode': 'oidc', 'stationAssignmentRequired': True,
                   'user': {'id': 'stable-user-id'}}
        with self.assertRaisesRegex(RuntimeError, 'station'):
            validate_session(session)
        session['user']['stationAssignment'] = {'shipName': 'Synthetic ship'}
        self.assertEqual(validate_session(session), 'stable-user-id')
        session['authMode'] = 'local_demo'
        with self.assertRaisesRegex(RuntimeError, 'OIDC'):
            validate_session(session)


if __name__ == '__main__':
    unittest.main()
