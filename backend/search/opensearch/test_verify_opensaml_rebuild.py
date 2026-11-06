import tempfile
import unittest
from pathlib import Path
import zipfile

from verify_opensaml_rebuild import FIXES, verify_bundle


class OpenSAMLRebuildTests(unittest.TestCase):
    def archives(self, directory, *, class_bytes=b'upstream class', version_override=None, extra=None):
        original, rebuilt = Path(directory) / 'original.jar', Path(directory) / 'rebuilt.jar'
        with zipfile.ZipFile(original, 'w') as jar:
            jar.writestr('org/opensaml/Example.class', b'upstream class')
        with zipfile.ZipFile(rebuilt, 'w') as jar:
            jar.writestr('org/opensaml/Example.class', class_bytes)
            for name, version in FIXES.items():
                jar.writestr('META-INF/maven/' + name + '/pom.properties',
                             'version=' + (version_override or version) + '\n')
            if extra:
                jar.writestr(extra, b'new class')
        return original, rebuilt

    def test_accepts_unchanged_upstream_classes_with_resolved_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            verify_bundle(*self.archives(directory, extra='org/jspecify/annotations/Nullable.class'))

    def test_rejects_changed_classes_old_metadata_and_unexpected_additions(self):
        for kwargs in [{'class_bytes': b'changed'}, {'version_override': 'old'},
                       {'extra': 'com/fasterxml/jackson/Unexpected.class'}]:
            with self.subTest(kwargs=kwargs), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    verify_bundle(*self.archives(directory, **kwargs))


if __name__ == '__main__':
    unittest.main()
