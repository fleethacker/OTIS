#!/usr/bin/env python3
"""Apply checksum-pinned standalone JAR updates to the pinned OpenSearch image.

OpenSAML is rebuilt in a separate Docker stage from pinned upstream source;
this standalone updater does not rewrite shaded classes or metadata.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request


def patch(root, lock):
    replacements = []
    with tempfile.TemporaryDirectory(prefix='opensearch-patches-') as directory:
        for index, item in enumerate(lock):
            targets = sorted(root.glob(item['pattern']))
            if len(targets) != item['count']:
                raise ValueError('Unexpected upstream JAR inventory for ' + item['pattern'])
            url = 'https://repo.maven.apache.org/maven2/' + item['maven_path']
            artifact = Path(directory) / str(index)
            with urllib.request.urlopen(url, timeout=60) as response, artifact.open('wb') as output:
                shutil.copyfileobj(response, output)
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError('Checksum mismatch for ' + url)
            filename = item['maven_path'].rsplit('/', 1)[-1]
            for target in targets:
                destination = target.with_name(filename)
                if destination != target and destination.exists():
                    raise ValueError('Duplicate dependency at ' + str(destination))
                replacements.append((target, artifact, destination))
        # Verify every download and inventory before replacing any installed file.
        for target, artifact, destination in replacements:
            shutil.copyfile(artifact, destination)
            if target != destination:
                target.unlink()
            print(str(target) + ' -> ' + destination.name, flush=True)


if __name__ == '__main__':
    patch(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()))
