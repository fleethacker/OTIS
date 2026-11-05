#!/usr/bin/env python3
"""Render all charts with bounded, nonsecret inputs and check package inventory/policies."""
import argparse
import ipaddress
import json
import re
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
    server = shared['SERVER']
    intake = server['intake']
    obsolete = {'sessionTtlSeconds', 'oidcPolicy', 'oidcPolicySecret', 'oidcKeySecret'}
    if obsolete.intersection(server):
        raise ValueError('obsolete Authservice settings: migrate to native OIDC inputs')
    network = ipaddress.ip_network(common['imapCidr'], strict=True)
    if network.prefixlen == 0 or network.is_multicast or network.is_unspecified:
        raise ValueError('mailbox egress must use a specific unicast network')
    if common['imapHost'] != intake['host'] or common['imapPort'] != intake['port']:
        raise ValueError('mailbox network and intake host/port must agree')
    if intake['transport'] != 'tls' or intake['tls_ca'] != '/etc/parse-command/mail/ca.crt':
        raise ValueError('verified implicit IMAP TLS and mounted CA are required')
    if intake['password_env'] != 'PARSE_COMMAND_IMAP_PASSWORD' or 'password' in intake:
        raise ValueError('credentials must reference the existing Kubernetes Secret')
    if any(k in intake for k in ('journal', 'max_database_bytes')):
        raise ValueError('SQLite intake settings require snapshot migration before native-state deployment')
    if intake.get('opensearch_url') != 'http://opensearch:9200':
        raise ValueError('intake must use the protected same-namespace OpenSearch endpoint')
    routing = intake.get('sourceRouting')
    if routing is not None:
        if not isinstance(routing, dict) or set(routing) != {'policyId', 'commandIds'}:
            raise ValueError('sourceRouting requires only policyId and commandIds')
        policy = routing['policyId']
        commands = routing['commandIds']
        if not isinstance(policy, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', policy):
            raise ValueError('sourceRouting policyId must be a bounded versioned identifier')
        if (not isinstance(commands, list) or not 1 <= len(commands) <= 32
                or any(not isinstance(command, str) or not command
                       or len(command.encode('utf-8')) > 256 or command.strip() != command
                       or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in command)
                       for command in commands)
                or len(set(commands)) != len(commands)):
            raise ValueError('sourceRouting requires 1–32 unique exact command IDs')
    state = server.get('stateIndex', '.parse-command-state-v1')
    custody = intake.get('custody_index', '.parse-command-custody-v1')
    if any(not isinstance(v, str) or not re.fullmatch(r'\.[a-z0-9][a-z0-9._-]{0,252}', v) for v in (state, custody)) or state == custody:
        raise ValueError('state and custody indices must be distinct hidden index names')
    admin = server.get('adminGroup', '/Parse Command/Admin')
    viewer = server.get('viewerGroup', '/Parse Command/Viewer')
    groups = common.get('allowedGroups', ['/Parse Command/Admin', '/Parse Command/Viewer'])
    if not isinstance(groups, list) or len(groups) != 2 or any(not isinstance(g, str) or not g.startswith('/') or len(g) > 256 for g in groups) or not isinstance(admin, str) or not isinstance(viewer, str) or set(groups) != {admin, viewer} or admin == viewer:
        raise ValueError('allowedGroups must match the distinct native Admin and Viewer group paths')
    gateway = common.get('idpGatewayIp', '')
    if not isinstance(gateway, str):
        raise ValueError('IdP gateway override must be an IP address string')
    if gateway:
        address = ipaddress.ip_address(gateway)
        permitted = [ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7')]
        if not any(address.version == n.version and address in n for n in permitted):
            raise ValueError('IdP gateway override must be a private unicast address')
    selector = common.get('idpSelector', {'app': 'tenant-ingressgateway'})
    if not isinstance(selector, dict) or not selector or any(not isinstance(k, str) or not isinstance(v, str) or not k or not v or '*' in k or '*' in v or len(k) > 253 or len(v) > 63 for k, v in selector.items()):
        raise ValueError('IdP egress requires a nonempty exact pod selector')
    namespace = common.get('idpNamespace', 'istio-tenant-gateway')
    if not isinstance(namespace, str) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', namespace):
        raise ValueError('IdP egress requires one namespace')
    port = common.get('idpPort', 8443)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('IdP egress port must be 1..65535')
    for field in ('legacyStorage', 'requireStateMigration', 'requireStationAssignment'):
        if type(server.get(field, False)) is not bool:
            raise ValueError(field + ' must be a boolean')
    for name in (common.get('clientSecretName', 'parse-command-oidc-client'), server.get('ssoSecret', 'parse-command-sso')):
        if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?', name):
            raise ValueError('native OIDC requires valid Secret names')
    if common.get('clientSecretName', 'parse-command-oidc-client') in {
        server.get('ssoSecret', 'parse-command-sso'), server.get('imapSecret', 'parse-command-imap')
    }:
        raise ValueError('generated client Secret must not overwrite existing session or mailbox Secrets')
    return shared


def required_secrets(shared):
    server = shared.get('SERVER', {})
    # Package.spec.sso generates the client Secret during installation.
    return [(server.get('ssoSecret', 'parse-command-sso'), ['session-key', 'ca.pem']),
            (server.get('imapSecret', 'parse-command-imap'), ['password', 'ca.crt'])]


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
    expected_pvcs = set() if shared.get('SEARCH', {}).get('storage', {}).get('existingClaim') else {'parse-command-search'}
    if shared['SERVER'].get('legacyStorage', False):
        expected_pvcs |= {'parse-command-' + name for name in ('custody', 'private') if not shared['SERVER'].get(name, {}).get('existingClaim')}
    assert {p['metadata']['name'] for p in pvcs} == expected_pvcs
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
    sso = package['spec']['sso'][0]
    assert 'enableAuthserviceSelector' not in sso
    assert sso['redirectUris'] == ['https://' + shared['COMMON']['host'] + '.' + shared['COMMON']['domain'] + '/auth/callback']
    assert sso['secretConfig']['name'] == shared['COMMON'].get('clientSecretName', 'parse-command-oidc-client')
    server = next(w for w in workloads if w['metadata']['name'] == 'parse-command-server')
    environment = {v['name']: v.get('value') for v in server['spec']['template']['spec']['containers'][0]['env']}
    assert environment['PARSE_COMMAND_AUTH_MODE'] == 'oidc'
    assert environment['PARSE_COMMAND_DEPLOYMENT_PROFILE'] == 'uds'
    assert environment['PARSE_COMMAND_SEARCH_SECURITY_POLICY'] == 'uds_mesh_mtls'
    assert environment['PARSE_COMMAND_REQUIRE_STATION_ASSIGNMENT'] == str(shared['SERVER'].get('requireStationAssignment', False)).lower()
    assert environment['PARSE_COMMAND_REQUIRE_STATE_MIGRATION'] == str(shared['SERVER'].get('requireStateMigration', False)).lower()
    assert set((environment['PARSE_COMMAND_ADMIN_GROUP'], environment['PARSE_COMMAND_VIEWER_GROUP'])) == set(sso['groups']['anyOf'])
    assert 'PARSE_COMMAND_PRIVATE_DB' not in environment
    pod = server['spec']['template']['spec']
    assert not any('persistentVolumeClaim' in volume for volume in pod['volumes'])
    assert any(v.get('secret', {}).get('secretName') == shared['SERVER'].get('ssoSecret', 'parse-command-sso') for v in pod['volumes'])
    assert any(r.get('remoteNamespace') == shared['COMMON'].get('idpNamespace', 'istio-tenant-gateway') and r.get('port') == shared['COMMON'].get('idpPort', 8443) for r in package['spec']['network']['allow'])
    assert len(package['spec']['network']['expose']) == 1
    assert package['spec']['network']['expose'][0]['service'] == 'web'
    assert not any(r.get('remoteGenerated') == 'Anywhere' for r in package['spec']['network']['allow'])
    assert any(d['kind'] == 'PeerAuthentication' and d['spec']['mtls']['mode'] == 'STRICT' for d in documents)
    print(f'Validated {len(documents)} rendered objects, retained search storage (optional legacy claims), four workload images, native OIDC, strict mesh policy, bounded mailbox inputs and three package definitions.')


if __name__ == '__main__':
    main()
