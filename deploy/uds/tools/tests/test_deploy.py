"""Platform compatibility gates: exercise package-list rows without cluster access."""
import json
from pathlib import Path
import sys
import unittest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from deploy import require_platform

VERSION = '1.14.3'


def row(package, version=VERSION):
    return {'package': package, 'version': version, 'namespaceOverride': ''}


class PlatformTests(unittest.TestCase):
    def test_slim_layers_and_existing_standard_platform_are_supported(self):
        for packages in ([row('core-base'), row('core-identity-authorization')],
                         [row('core')],
                         [row('init', 'v0.86.0'), row('core-base'), row('core-identity-authorization')]):
            with self.subTest(packages=packages):
                require_platform(packages, VERSION)

    def test_base_alone_or_identity_alone_cannot_skip_required_capabilities(self):
        for packages in ([], [row('core-base')], [row('core-identity-authorization')], [row('other')]):
            with self.subTest(packages=packages), self.assertRaisesRegex(ValueError, 'core-base and core-identity'):
                require_platform(packages, VERSION)

    def test_mixed_versions_and_similar_version_prefixes_are_rejected(self):
        for bad in ('1.13.0', '1.14.30', '1.14.3-rc.1', '', None):
            for packages in ([row('core-base'), row('core-identity-authorization', bad)],
                             [row('core', bad)],
                             [row('core'), row('core-base', bad)]):
                with self.subTest(packages=packages), self.assertRaisesRegex(ValueError, 'must match pinned version'):
                    require_platform(packages, VERSION)

    def test_pinned_release_flavor_suffixes_are_supported(self):
        for flavor in ('upstream', 'registry1', 'unicorn'):
            packages = [row('core-base', VERSION + '-' + flavor), row('core-identity-authorization', VERSION + '-' + flavor)]
            require_platform(packages, VERSION)

    def test_malformed_package_list_is_rejected(self):
        for packages in ({'packages': []}, None, ['core-base']):
            with self.subTest(packages=packages), self.assertRaisesRegex(ValueError, 'JSON array'):
                require_platform(packages, VERSION)

    def test_local_profile_and_version_lock_agree(self):
        root = TOOLS.parent
        profile = json.loads((root / 'profiles/local-arm64.json').read_text())
        pins = json.loads((root / 'versions.json').read_text())
        self.assertEqual(profile['udsCore'], pins['uds_core'])
        self.assertEqual(profile['platformBundle'], 'oci://ghcr.io/defenseunicorns/packages/uds/bundles/k3d-core-slim-dev:' + pins['uds_core'])
        require_platform([row(name, pins['uds_core']) for name in profile['requiredCorePackages']], pins['uds_core'])
        self.assertFalse(profile['capacityValidated'])


if __name__ == '__main__':
    unittest.main()
