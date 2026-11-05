#!/usr/bin/env python3
"""Connected ARM64 artifact build; all outputs remain under ignored directories."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[1]
PINS = json.loads((HERE / 'versions.json').read_text())
REGISTRY_IMAGE = 'registry:3.1.2@sha256:d4032d4cc323c1731c707931ecada07a53076eac38e3b61ae57533f170f2c6c3'
REGISTRY = '127.0.0.1:5119'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def source_hash():
    paths = output('git', '-C', str(ROOT), 'ls-files', '-co', '--exclude-standard', '-z').split('\0')
    inventory = {}
    for name in sorted(set(paths) - {''}):
        path = ROOT / name
        if path.is_file():
            with path.open('rb') as stream:
                inventory[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--prepare-assets', action='store_true', help='Explicit connected download of pinned model/native assets')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', args.version):
        parser.error('version must be a semantic version')
    if output('uds', 'version') != 'v' + PINS['uds_cli'] or output('uds', 'zarf', 'version') != 'v' + PINS['embedded_zarf']:
        raise SystemExit('Use the pinned UDS CLI and its embedded Zarf; see versions.json')
    if args.prepare_assets:
        run('python3', str(ROOT / 'backend/search/prepare_assets.py'))
        run('python3', str(ROOT / 'backend/search/prepare_native.py'), '--arch', 'arm64')
    run('python3', '-c', 'import sys; sys.path.insert(0, sys.argv[1]); import deploy; deploy.pin_and_verify()', str(ROOT / 'backend/search'))
    work = HERE / '.work' / args.version
    destination = HERE / '.artifacts' / args.version
    if (destination / 'SHA256SUMS').exists():
        raise SystemExit('Refusing to replace a completed release; choose a new version')
    work.mkdir(parents=True, exist_ok=True)
    destination.mkdir(parents=True, exist_ok=True)
    # A dedicated loopback registry permits immutable digest references for local builds.
    # Never stop/replace another container or publish to an external registry.
    existing = subprocess.run(['docker', 'container', 'inspect', 'parse-command-issue9-registry'], capture_output=True, text=True)
    if existing.returncode:
        run('docker', 'run', '-d', '--name', 'parse-command-issue9-registry', '--label', 'dev.parse-command.artifact-builder=true', '-p', f'{REGISTRY}:5000', REGISTRY_IMAGE)
    else:
        info = json.loads(existing.stdout)[0]
        if info['Config'].get('Labels', {}).get('dev.parse-command.artifact-builder') != 'true' or not info['State']['Running']:
            raise SystemExit('Build registry name occupied or stopped; inspect it before retrying')
    for _ in range(30):
        try:
            with urllib.request.urlopen(f'http://{REGISTRY}/v2/', timeout=2):
                break
        except OSError:
            import time
            time.sleep(1)
    else:
        raise SystemExit('loopback registry did not become ready')
    sources = {
        'SERVER': ROOT / 'backend/Dockerfile',
        'UI': ROOT / 'apps/watch-desk/Dockerfile',
        'SEARCH': ROOT / 'backend/search/opensearch/Dockerfile',
        'BOOTSTRAP': HERE / 'bootstrap.Dockerfile',
    }
    source_digest = source_hash()
    images = {}
    for key, dockerfile in sources.items():
        ref = f'{REGISTRY}/parse-command/{key.lower()}:{args.version}'
        context = {'SEARCH': ROOT / 'backend/search', 'UI': ROOT / 'apps/watch-desk'}.get(key, ROOT)
        run('docker', 'build', '--platform', 'linux/arm64', '--build-arg', 'TARGETARCH=arm64', '-f', str(dockerfile), '-t', ref, str(context))
        run('docker', 'push', ref)
        digests = json.loads(output('docker', 'image', 'inspect', ref, '--format', '{{json .RepoDigests}}'))
        images[key + '_IMAGE'] = next(d for d in digests if d.startswith(REGISTRY + '/'))
    source = work / 'source'
    shutil.copytree(HERE / 'charts', source / 'charts', dirs_exist_ok=True)
    shutil.copytree(HERE / 'packages', source / 'packages', dirs_exist_ok=True)
    packages = destination / 'packages'
    packages.mkdir(exist_ok=True)
    for name in ['opensearch', 'server', 'ui']:
        command = ['uds', 'zarf', 'package', 'create', str(source / 'packages' / name), '--confirm', '--architecture', 'arm64', '--plain-http', '--output', str(packages), '--set', 'VERSION=' + args.version]
        command += [part for k, v in images.items() for part in ['--set', k + '=' + v]]
        run(*command)
    bundle = destination / 'bundle'
    bundle.mkdir(exist_ok=True)
    spec = json.loads((HERE / 'bundle/uds-bundle.yaml').read_text())
    spec['metadata']['version'] = args.version
    for package in spec['packages']:
        package['ref'] = args.version
    (bundle / 'uds-bundle.yaml').write_text(json.dumps(spec, indent=2) + '\n')
    run('uds', 'create', str(bundle), '--confirm', '--architecture', 'arm64', '--output', str(destination))
    if source_hash() != source_digest:
        raise SystemExit('Source changed during the build; retry before issuing this release')
    manifest = {'sourceTreeSha256': source_digest, 'version': args.version, 'gitCommit': output('git', '-C', str(ROOT), 'rev-parse', 'HEAD'), 'dirty': bool(output('git', '-C', str(ROOT), 'status', '--porcelain')), 'pins': PINS, 'images': images}
    (destination / 'artifact-lock.json').write_text(json.dumps(manifest, indent=2) + '\n')
    checksums = []
    for path in sorted(destination.rglob('*')):
        if path.is_file():
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            checksums.append(digest + '  ' + str(path.relative_to(destination)))
    (destination / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    print(destination)


if __name__ == '__main__':
    main()
