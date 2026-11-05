#!/usr/bin/env python3
"""Render all charts with bounded, nonsecret inputs and check package inventory/policies."""
import argparse
import ipaddress
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parents[1]


def output(*command):
    return subprocess.check_output(command, text=True)


def load_config(path):
    # uds-config.yaml accepts YAML; use the parser bundled with the pinned CLI.
    return json.loads(output('uds', 'zarf', 'tools', 'yq', '-o=json', '.', str(path)))


def inputs(config):
    shared = config['shared']
    common = shared['COMMON']
    intake = shared['SERVER']['intake']
    network = ipaddress.ip_network(common['imapCidr'], strict=True)
    if network.prefixlen == 0 or network.is_multicast or network.is_unspecified:
        raise ValueError('mailbox egress must use a specific unicast network')
    if common['imapHost'] != intake['host'] or common['imapPort'] != intake['port']:
        raise ValueError('mailbox network and intake host/port must agree')
    if intake['transport'] != 'tls' or intake['tls_ca'] != '/etc/parse-command/mail/ca.crt':
        raise ValueError('verified implicit IMAP TLS and mounted CA are required')
    if intake['password_env'] != 'PARSE_COMMAND_IMAP_PASSWORD' or 'password' in intake:
        raise ValueError('credentials must reference the existing Kubernetes Secret')
    return shared


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=HERE / 'uds-config.example.yaml')
    args = parser.parse_args()
    shared = inputs(load_config(args.config))
    documents = []
    fake = '127.0.0.1:5119/parse-command/validation@sha256:' + 'a' * 64
    with tempfile.TemporaryDirectory(prefix='parse-command-helm-') as directory:
        values = Path(directory) / 'values.json'
        for name, key in [('config', 'COMMON'), ('opensearch', 'SEARCH'), ('server', 'SERVER'), ('ui', 'UI')]:
            values.write_text(json.dumps({'common': shared['COMMON'], 'config': shared.get(key, {}), 'image': fake, 'bootstrapImage': fake}))
            command = ['helm', 'template', 'parse-command-' + name, str(HERE / 'charts' / name), '--namespace', shared['NAMESPACE'], '--values', str(values)]
            rendered = Path(directory) / (name + '.yaml')
            rendered.write_text(output(*command))
            documents += json.loads(output('uds', 'zarf', 'tools', 'yq', 'eval-all', '-o=json', '[.]', str(rendered)))
            if name == 'config':
                continue
            subprocess.run(['uds', 'zarf', 'dev', 'lint', str(HERE / 'packages' / name), '--architecture', 'arm64', '--set', 'VERSION=0.1.0-validation', '--set', 'NAMESPACE=' + shared['NAMESPACE'], '--set', key + '_IMAGE=' + fake, '--set', 'BOOTSTRAP_IMAGE=' + fake], check=True)
    documents = [d for d in documents if d]
    pvcs = [d for d in documents if d['kind'] == 'PersistentVolumeClaim']
    assert {p['metadata']['name'] for p in pvcs} == {'parse-command-search', 'parse-command-custody', 'parse-command-private'}
    assert all(p['metadata']['annotations']['helm.sh/resource-policy'] == 'keep' for p in pvcs)
    workloads = [d for d in documents if d['kind'] in ('Deployment', 'StatefulSet', 'Job')]
    for workload in workloads:
        pod = workload['spec']['template']['spec']
        assert pod['nodeSelector']['kubernetes.io/arch'] == 'arm64'
        assert pod['automountServiceAccountToken'] is False
        assert pod['securityContext']['runAsNonRoot']
        for container in pod['containers']:
            security = container['securityContext']
            assert security['allowPrivilegeEscalation'] is False and security['capabilities']['drop'] == ['ALL']
    package = next(d for d in documents if d['kind'] == 'Package')
    assert package['spec']['sso'][0]['enableAuthserviceSelector'] == {'app': 'parse-command-ui'}
    server = next(w for w in workloads if w['metadata']['name'] == 'parse-command-server')
    environment = {v['name']: v.get('value') for v in server['spec']['template']['spec']['containers'][0]['env']}
    groups = json.loads(environment['PARSE_COMMAND_ALLOWED_GROUPS_JSON'])
    assert isinstance(groups, list) and 1 <= len(groups) <= 32
    assert groups == package['spec']['sso'][0]['groups']['anyOf']
    assert len(package['spec']['network']['expose']) == 1
    assert package['spec']['network']['expose'][0]['service'] == 'web'
    assert not any(r.get('remoteGenerated') == 'Anywhere' for r in package['spec']['network']['allow'])
    assert any(d['kind'] == 'PeerAuthentication' and d['spec']['mtls']['mode'] == 'STRICT' for d in documents)
    print(f'Validated {len(documents)} rendered objects, three independent retained PVCs, four workload images, SSO, strict mesh policy, bounded mailbox inputs and three package definitions.')


if __name__ == '__main__':
    main()
