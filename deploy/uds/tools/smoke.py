#!/usr/bin/env python3
"""Explicit synthetic SMTP -> IMAP intake -> publication -> authenticated application read.

Never called by install. The operator supplies a test mailbox, synthetic message,
HTTPS origin, trusted CA and a short-lived Keycloak token file.
"""
import argparse
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import json
from pathlib import Path
import smtplib
import ssl
import time
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('expected authenticated JSON; received an identity redirect')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--origin', required=True)
    p.add_argument('--ca', required=True)
    p.add_argument('--token-file', type=Path, required=True)
    p.add_argument('--smtp-host', required=True)
    p.add_argument('--smtp-port', type=int, default=465)
    p.add_argument('--smtp-user', required=True)
    p.add_argument('--smtp-password-file', type=Path, required=True)
    p.add_argument('--smtp-ca', required=True)
    p.add_argument('--recipient', required=True, help='Dedicated test mailbox monitored by this deployment')
    p.add_argument('--body', type=Path, required=True, help='Operator-reviewed synthetic USMTF body; never real traffic')
    p.add_argument('--deadline', type=int, default=300)
    a = p.parse_args()
    if not a.origin.startswith('https://') or not 1 <= a.deadline <= 900:
        p.error('verified HTTPS and a 1..900 second deadline are required')
    token = a.token_file.read_text().strip()
    if not token or len(token) > 16384 or a.body.stat().st_size > 65536:
        p.error('bounded token and synthetic body required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=a.ca)), NoRedirect())
    def api(path, body):
        req = urllib.request.Request(a.origin.rstrip('/') + path, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with opener.open(req, timeout=15) as response:
            payload = response.read(4_194_305)
            if len(payload) > 4_194_304:
                raise RuntimeError('application response limit')
            return json.loads(payload)
    identity = api('/app.v1.AppService/GetIdentity', {})
    if not identity.get('username', '').startswith('oidc:'):
        raise RuntimeError('UDS verified subject missing')
    marker = 'UDS SYNTHETIC ' + uuid.uuid4().hex
    message = EmailMessage()
    message['Subject'] = 'SUBJ: ' + marker
    message['From'] = a.smtp_user
    message['To'] = a.recipient
    message['Date'] = formatdate(localtime=False, usegmt=True)
    message['Message-ID'] = make_msgid(domain='example.invalid')
    message.set_content(a.body.read_text())
    with smtplib.SMTP_SSL(a.smtp_host, a.smtp_port, timeout=15, context=ssl.create_default_context(cafile=a.smtp_ca)) as smtp:
        smtp.login(a.smtp_user, a.smtp_password_file.read_text().strip())
        smtp.send_message(message)
    deadline = time.monotonic() + a.deadline
    while time.monotonic() < deadline:
        data = api('/api/v1/messages/list', {})
        matches = [m for m in data.get('messages', []) if marker in json.dumps(m)]
        if matches:
            status = api('/api/v1/source/status', None)
            if not status.get('modelReady') or not status.get('publicationReady'):
                time.sleep(5)
                continue
            print(json.dumps({'status': 'published_and_read', 'subject': marker, 'count': len(matches)}))
            print('Browser gate remains: sign in via Keycloak and locate this subject in the UI; check source detail and save/reopen a private draft.')
            return
        time.sleep(5)
    raise SystemExit('Synthetic subject did not reach the real application within the deadline; inspect intake/publication status and logs')


if __name__ == '__main__':
    main()
