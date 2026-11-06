import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch as mock_patch

from patch_dependencies import patch


class DependencyPatchTests(unittest.TestCase):
    def test_inventory_or_checksum_failure_preserves_installed_jars(self):
        for count, checksum in [(2, hashlib.sha256(b'fixed').hexdigest()), (1, '0' * 64)]:
            with self.subTest(count=count), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                old = root / 'old.jar'
                old.write_bytes(b'original')
                lock = [{'pattern': 'old.jar', 'count': count,
                         'maven_path': 'group/new.jar', 'sha256': checksum}]
                with mock_patch('patch_dependencies.urllib.request.urlopen', return_value=io.BytesIO(b'fixed')):
                    with self.assertRaises(ValueError):
                        patch(root, lock)
                self.assertEqual(old.read_bytes(), b'original')
                self.assertFalse((root / 'new.jar').exists())

    def test_replaces_every_copy_and_preserves_shaded_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['core', 'plugin']:
                (root / name).mkdir()
                (root / name / 'old.jar').write_bytes(b'original')
            shaded = root / 'opensaml-all.jar'
            shaded.write_bytes(b'upstream bundle')
            lock = [{'pattern': '**/old.jar', 'count': 2,
                     'maven_path': 'group/new.jar', 'sha256': hashlib.sha256(b'fixed').hexdigest()}]
            with mock_patch('patch_dependencies.urllib.request.urlopen', return_value=io.BytesIO(b'fixed')):
                patch(root, lock)
            self.assertFalse(list(root.rglob('old.jar')))
            self.assertEqual([p.read_bytes() for p in sorted(root.rglob('new.jar'))], [b'fixed', b'fixed'])
            self.assertEqual(shaded.read_bytes(), b'upstream bundle')


if __name__ == '__main__':
    unittest.main()
