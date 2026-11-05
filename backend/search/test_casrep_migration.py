"""ICD upgrades preserve vectors and reject a different model or geometry."""
import copy
import unittest
import deploy
from search_config import index_definition


class CasrepMappingUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.expected = index_definition('local-model', 'pinned-model-hash')['mappings']

    def test_old_pinned_mapping_upgrades_additively(self):
        current = copy.deepcopy(self.expected)
        current['_meta']['icd_version'] = '1.1.0'
        current['properties'].pop('casualty')
        upgrade = deploy.compatible_mapping_upgrade(current, self.expected)
        self.assertEqual(set(upgrade['properties']), {'casualty', 'movements'})
        self.assertEqual(upgrade['_meta']['icd_version'], '1.4.0')
        self.assertEqual(current['properties']['embedding'], self.expected['properties']['embedding'])

    def test_existing_runtime_mapping_can_be_pinned_without_reindexing(self):
        current = copy.deepcopy(self.expected)
        current['_meta'] = {'icd_version': '1.1.0', 'profile': 'ui_fixture_lexical_no_retention'}
        self.assertEqual(deploy.compatible_mapping_upgrade(current, self.expected)['_meta']['model_sha256'], 'pinned-model-hash')

    def test_model_chunker_geometry_and_unknown_profiles_fail_closed(self):
        for key, value in [('model_sha256', 'different-model'), ('chunker', 'different-chunker'), ('profile', 'unknown'), ('icd_version', '2.0.0')]:
            current = copy.deepcopy(self.expected)
            current['_meta'][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                deploy.compatible_mapping_upgrade(current, self.expected)
        current = copy.deepcopy(self.expected)
        current['properties']['embedding']['dimension'] = 768
        with self.assertRaises(RuntimeError):
            deploy.compatible_mapping_upgrade(current, self.expected)


if __name__ == '__main__':
    unittest.main()
