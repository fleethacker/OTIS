#!/usr/bin/env python3
"""Explicit synthetic SMTP -> IMAP intake -> publication -> authenticated application read.

Never called by install. The operator supplies a test mailbox, synthetic message,
HTTPS origin, trusted CA and a protected native-session Cookie header file.
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
import urllib.parse
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('expected authenticated JSON; received an identity redirect')


def read_session_cookie(path):
    cookie = path.read_text().strip()
    if not cookie.startswith('parse_command_session=') or not cookie.partition('=')[2] or len(cookie) > 16384 or any(ord(c) < 33 or c == ';' for c in cookie):
        raise ValueError('one bounded native session cookie is required')
    return cookie


def validate_origin(origin):
    value = urllib.parse.urlsplit(origin)
    if (value.scheme != 'https' or not value.hostname or value.username is not None
            or value.password is not None or value.path not in ('', '/')
            or value.query or value.fragment):
        raise ValueError('use an exact HTTPS application origin without credentials, path or query')
    return origin.rstrip('/')


def validate_session(session):
    if session.get('authenticated') is not True or session.get('authMode') != 'oidc':
        raise RuntimeError('verified native OIDC application session missing')
    user = session.get('user') or {}
    if not isinstance(user.get('id'), str) or not user['id']:
        raise RuntimeError('stable application user ID missing')
    if session.get('stationAssignmentRequired') and not user.get('stationAssignment'):
        raise RuntimeError('assign the test account to its approved station before sending synthetic mail')
    return user['id']


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--origin', required=True)
    p.add_argument('--ca', required=True)
    p.add_argument('--cookie-file', type=Path, required=True, help='Protected file containing parse_command_session=<opaque session>, obtained by real browser OIDC login')
    p.add_argument('--smtp-host', required=True)
    p.add_argument('--smtp-port', type=int, default=465)
    p.add_argument('--smtp-user', required=True)
    p.add_argument('--smtp-password-file', type=Path, required=True)
    p.add_argument('--smtp-ca', required=True)
    p.add_argument('--recipient', required=True, help='Dedicated test mailbox monitored by this deployment')
    p.add_argument('--body', type=Path, required=True, help='Operator-reviewed synthetic USMTF body; never real traffic')
    p.add_argument('--deadline', type=int, default=300)
    a = p.parse_args()
    if not 1 <= a.deadline <= 900:
        p.error('a 1..900 second deadline is required')
    try:
        origin = validate_origin(a.origin)
        cookie = read_session_cookie(a.cookie_file)
    except ValueError as error:
        p.error(str(error))
    if a.body.stat().st_size > 65536:
        p.error('bounded synthetic body required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=a.ca)), NoRedirect())
    def api(path, body):
        req = urllib.request.Request(origin + path, data=None if body is None else json.dumps(body).encode(), headers={'Cookie': cookie, 'Origin': origin, 'Content-Type': 'application/json'})
        with opener.open(req, timeout=15) as response:
            payload = response.read(4_194_305)
            if len(payload) > 4_194_304:
                raise RuntimeError('application response limit')
            return json.loads(payload)
    session = api('/api/v1/auth/session', None)
    validate_session(session)
    identity = api('/app.v1.AppService/GetIdentity', {})
    if not session['user'].get('username') or identity.get('username') != session['user']['username']:
        raise RuntimeError('application and RPC display identity disagree')
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
        data = api('/api/v1/messages/search', {'query': marker, 'mode': 'keyword'})
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
