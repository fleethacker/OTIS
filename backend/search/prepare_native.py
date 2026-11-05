#!/usr/bin/env python3
"""Connected, resumable preparation of the pinned CPU tensor helper."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
BASE = 'https://publish.djl.ai/pytorch/2.5.1/'


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(40):
        result = subprocess.run([
            'curl', '--fail', '--silent', '--show-error', '--connect-timeout', '10',
            '--max-time', '45', '--continue-at', '-', '--output', str(target), url,
        ], check=False)
        if result.returncode == 0:
            return
    raise RuntimeError('native_asset_download_deadline: ' + target.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=('arm64', 'amd64'), required=True)
    args = parser.parse_args()
    classifier = 'linux-aarch64' if args.arch == 'arm64' else 'linux-x86_64'
    prefix = 'cpu-precxx11/' + classifier + '/'
    root = ROOT / 'assets/native' / args.arch
    cache = root / 'cache/pytorch'
    libraries = cache / ('2.5.1-cpu-precxx11-' + classifier)
    libraries.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(BASE + 'files.txt', timeout=30) as response:
        manifest = response.read(1_048_576).decode()
    (cache / '2.5.1.txt').write_text(manifest)
    paths = [p for p in manifest.splitlines() if p.startswith(prefix)]
    if not paths or len(paths) > 32:
        raise RuntimeError('native_manifest_layout')

    def prepare(path):
        filename = urllib.parse.unquote(path.rsplit('/', 1)[-1])
        target = libraries / filename[:-3]
        if not filename.endswith('.gz') or '/' in filename or '..' in filename:
            raise RuntimeError('native_manifest_path')
        if not target.exists():
            compressed = root / 'downloads' / filename
            download(BASE + path, compressed)
            size = 0
            with gzip.open(compressed, 'rb') as source, target.with_suffix(target.suffix + '.part').open('wb') as out:
                while True:
                    block = source.read(1_048_576)
                    if not block:
                        break
                    size += len(block)
                    if size > 1_073_741_824:
                        raise RuntimeError('native_uncompressed_limit')
                    out.write(block)
            target.with_suffix(target.suffix + '.part').replace(target)
        print(json.dumps({'native_asset': target.name, 'bytes': target.stat().st_size}), flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(prepare, paths))
    bridge = libraries / '0.31.1-libdjl_torch.so'
    if not bridge.exists():
        partial = root / 'downloads/libdjl_torch.so.part'
        download(BASE + 'jnilib/0.31.1/' + classifier + '/cpu-precxx11/libdjl_torch.so', partial)
        partial.replace(bridge)
    hashes = {}
    for file in sorted((root / 'cache').rglob('*')):
        if file.is_file():
            digest = hashlib.sha256()
            with file.open('rb') as stream:
                for block in iter(lambda: stream.read(1_048_576), b''):
                    digest.update(block)
            hashes[str(file.relative_to(root / 'cache'))] = digest.hexdigest()
    (root / 'SHA256SUMS').write_text(''.join(digest + '  ' + name + '\n' for name, digest in hashes.items()))
    print(json.dumps({'arch': args.arch, 'files': len(hashes), 'native_manifest': str(root / 'SHA256SUMS')}))


if __name__ == '__main__':
    main()
