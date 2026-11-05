#!/usr/bin/env python3
"""Check the packaged namespaces and image values, not only source templates.

Requires Python 3.14's standard-library Zstandard archive reader.
"""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tarfile


def yaml_json(data):
    return json.loads(subprocess.check_output(
        ['uds', 'zarf', 'tools', 'yq', '-o=json', '.'], input=data))


def verify_packages(directory, version, namespace, images):
    for name, key in [('opensearch', 'SEARCH'), ('server', 'SERVER'), ('ui', 'UI')]:
        path = directory / f'zarf-package-parse-command-{name}-arm64-{version}.tar.zst'
        with tarfile.open(path) as archive:
            definition = yaml_json(archive.extractfile('zarf.yaml').read())
            expected = {'image': images[key + '_IMAGE']}
            if name == 'opensearch':
                expected['bootstrapImage'] = images['BOOTSTRAP_IMAGE']
            packaged_images = []
            for component in definition['components']:
                packaged_images += component.get('images', [])
                for chart in component.get('charts', []):
                    if chart['namespace'] != namespace:
                        raise ValueError(f'{name}: unresolved or incorrect chart namespace')
            if set(packaged_images) != set(expected.values()):
                raise ValueError(f'{name}: packaged image inventory differs from lock')
            with tarfile.open(fileobj=io.BytesIO(archive.extractfile(f'components/{name}.tar').read())) as component:
                values = [m for m in component.getmembers() if m.isfile() and '/values/' in m.name]
                if len(values) != 1 or yaml_json(component.extractfile(values[0]).read()) != expected:
                    raise ValueError(f'{name}: packaged chart image values differ from lock')
    print('Verified all packaged chart namespaces, concrete digest values and image inventories.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    args = parser.parse_args()
    lock = json.loads((args.release / 'artifact-lock.json').read_text())
    verify_packages(args.release / 'packages', lock['version'], lock['namespace'], lock['images'])


if __name__ == '__main__':
    main()
