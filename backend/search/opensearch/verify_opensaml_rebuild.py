#!/usr/bin/env python3
"""Check the upstream aggregate rebuild without modifying its archive contents."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile


FIXES = {
    'com.fasterxml.jackson.core/jackson-core': '2.22.3',
    'com.fasterxml.jackson.core/jackson-databind': '2.22.3',
    'com.google.guava/guava': '33.7.2-jre',
    'com.google.guava/failureaccess': '1.0.3',
}


def verify_bundle(original, rebuilt):
    with zipfile.ZipFile(original) as before, zipfile.ZipFile(rebuilt) as after:
        old_classes = {name: before.read(name) for name in before.namelist() if name.endswith('.class')}
        new_classes = {name: after.read(name) for name in after.namelist() if name.endswith('.class')}
        if any(new_classes.get(name) != contents for name, contents in old_classes.items()):
            raise ValueError('An existing OpenSAML class changed during dependency-only rebuild')
        added = set(new_classes) - set(old_classes)
        if any(not name.startswith('org/jspecify/annotations/') for name in added):
            raise ValueError('Unexpected executable classes in rebuilt aggregate')
        if any(name.startswith(('com/fasterxml/', 'com/google/common/')) for name in new_classes):
            raise ValueError('Upstream Jackson/Guava class exclusions were not retained')
        for dependency, version in FIXES.items():
            name = 'META-INF/maven/' + dependency + '/pom.properties'
            properties = dict(line.split('=', 1) for line in after.read(name).decode().splitlines()
                              if '=' in line and not line.startswith('#'))
            if properties.get('version') != version:
                raise ValueError('Unexpected resolved dependency version for ' + dependency)
        print('Verified unchanged upstream classes and patched dependency metadata', flush=True)


def verify_downloads(lock, cache):
    for dependency, version in FIXES.items():
        group, artifact = dependency.split('/')
        path = group.replace('.', '/') + '/' + artifact + '/' + version + '/' + artifact + '-' + version + '.jar'
        item = next(item for item in lock if item['maven_path'] == path)
        artifacts = list((cache / group / artifact / version).glob('*/*.jar'))
        if len(artifacts) != 1 or hashlib.sha256(artifacts[0].read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Resolved artifact checksum mismatch for ' + dependency)


if __name__ == '__main__':
    verify_downloads(json.loads(Path(sys.argv[3]).read_text()), Path(sys.argv[4]))
    verify_bundle(Path(sys.argv[1]), Path(sys.argv[2]))
