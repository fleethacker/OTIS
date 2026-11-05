#!/usr/bin/env python3
"""Deploy a transferred app bundle to an explicitly selected existing UDS cluster."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from validate import inputs, load_config, required_secrets


def capture(*command, **kwargs):
    return subprocess.check_output(command, text=True, **kwargs)


def require_platform(packages, expected_version):
    """Require SSO-capable Core, installed either together or as functional layers."""
    if not isinstance(packages, list) or any(not isinstance(p, dict) for p in packages):
        raise ValueError('Expected the pinned Zarf package-list JSON array')
    names = {'core', 'core-base', 'core-identity-authorization'}
    core = [p for p in packages if p.get('package') in names]
    versions = {expected_version, *(expected_version + '-' + flavor for flavor in ('upstream', 'registry1', 'unicorn'))}
    if any(p.get('version') not in versions for p in core):
        raise ValueError('All installed Core packages must match pinned version ' + expected_version)
    installed = {p['package'] for p in core}
    if 'core' in installed or {'core-base', 'core-identity-authorization'} <= installed:
        return
    raise ValueError('UDS Core ' + expected_version + ' is required: install core-base and core-identity-authorization (slim-dev), or the standard core package')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--context', required=True, help='Explicit target context; current-context is never changed')
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--bundle', type=Path, required=True)
    a = p.parse_args()
    config = a.config.resolve()
    bundle = a.bundle.resolve()
    shared = inputs(load_config(config))
    common = shared['COMMON']
    if common['imapHost'].endswith('.invalid'):
        p.error('replace the example mailbox endpoint before deployment')
    checksums = bundle.parent / 'SHA256SUMS'
    lines = dict(line.split('  ', 1)[::-1] for line in checksums.read_text().splitlines())
    with bundle.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != lines[bundle.name]:
            raise SystemExit('bundle checksum mismatch')
    # Keep a context-specific kubeconfig private and temporary; do not alter the user's context.
    with tempfile.TemporaryDirectory(prefix='parse-command-deploy-') as directory:
        kubeconfig = Path(directory) / 'kubeconfig'
        descriptor = os.open(kubeconfig, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            subprocess.run(['kubectl', '--context', a.context, 'config', 'view', '--minify', '--flatten', '--raw'], stdout=stream, check=True)
        env = dict(os.environ, KUBECONFIG=str(kubeconfig), UDS_CONFIG=str(config))
        nodes = json.loads(capture('kubectl', 'get', 'nodes', '-o', 'json', env=env))['items']
        if not nodes or any(n['status']['nodeInfo']['architecture'] != 'arm64' or n['status']['nodeInfo']['operatingSystem'] != 'linux' for n in nodes):
            raise SystemExit('This release supports Linux ARM64 nodes only')
        subprocess.run(['kubectl', 'get', 'crd', 'packages.uds.dev'], env=env, check=True, stdout=subprocess.DEVNULL)
        packages = json.loads(capture('uds', 'zarf', 'package', 'list', '-o', 'json', env=env))
        # Pinned Zarf 0.86 emits rows with package/version (not metadata.name).
        pins = json.loads((Path(__file__).resolve().parents[1] / 'versions.json').read_text())
        try:
            require_platform(packages, pins['uds_core'])
        except ValueError as error:
            raise SystemExit(str(error)) from None
        namespace = shared['NAMESPACE']
        if namespace in {'default', 'zarf', 'keycloak', 'pepr-system'} or namespace.startswith(('kube-', 'istio-', 'uds-')):
            raise SystemExit('Use a dedicated application namespace; UDS policy applies to the whole namespace')
        subprocess.run(['kubectl', 'get', 'namespace', namespace], env=env, check=True, stdout=subprocess.DEVNULL)
        pods = json.loads(capture('kubectl', '-n', namespace, 'get', 'pods', '-o', 'json', env=env))['items']
        applications = {'parse-command-server', 'parse-command-search', 'parse-command-ui', 'parse-command-bootstrap'}
        if any(pod['metadata'].get('labels', {}).get('app') not in applications for pod in pods):
            raise SystemExit('Unrelated pods exist in the target namespace; choose a dedicated namespace')
        for secret, keys in required_secrets(shared):
            # Only key names and non-empty presence are checked. No values reach stdout.
            value = json.loads(capture('kubectl', '-n', namespace, 'get', 'secret', secret, '-o', 'json', env=env))
            if any(not value.get('data', {}).get(k) for k in keys):
                raise SystemExit('required secret keys are missing: ' + secret)
        subprocess.run(['uds', 'deploy', str(bundle), '--confirm', '--architecture', 'arm64'], env=env, check=True)
        subprocess.run(['kubectl', '-n', namespace, 'rollout', 'status', 'statefulset/opensearch', '--timeout=10m'], env=env, check=True)
        for deployment in ['parse-command-server', 'parse-command-ui']:
            subprocess.run(['kubectl', '-n', namespace, 'rollout', 'status', 'deployment/' + deployment, '--timeout=10m'], env=env, check=True)
    print('Workloads ready. Run the explicit synthetic mail/API/browser and persistence gates in README.md.')


if __name__ == '__main__':
    main()
