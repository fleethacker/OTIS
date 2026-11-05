#!/usr/bin/env python3
"""Real HTTP acceptance on an explicitly isolated local scenario (no mocked services)."""
import argparse
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:18420')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    url = urllib.parse.urlsplit(base)
    if url.hostname not in ('127.0.0.1', 'localhost') or not url.port:
        raise SystemExit('Use an isolated loopback test origin')
    def client():
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(opener, path, body=None, method='POST', origin=True):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = base
        req = urllib.request.Request(base + path, data=json.dumps(body or {}).encode(), headers=headers, method=method)
        try:
            with opener.open(req, timeout=15) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            payload = error.read()
            try:
                value = json.loads(payload)
            except json.JSONDecodeError:
                value = {'message': payload.decode('utf-8', errors='replace')}
            return error.code, value
    def login(role):
        opener = client()
        req = urllib.request.Request(base + '/__ark/mock-login', data=urllib.parse.urlencode({'role':role,'return':'/assigned-work'}).encode(), headers={'Content-Type':'application/x-www-form-urlencoded','Origin':base})
        with opener.open(req, timeout=15) as response:
            assert response.status == 200
        return opener
    checks=[]
    assert call(client(), '/api/v1/work/list')[0] == 401
    checks.append('Unauthenticated work reads rejected (401)')
    admin, viewer = login('admin'), login('viewer')
    status, feed = call(viewer, '/api/v1/work/list')
    assert status == 200 and len(feed['items']) == 3
    original = next(task for task in feed['items'] if task['logicalEventId'].endswith(':original'))
    request={'taskId':original['id'],'expectedVersion':original['version'],'eventVersion':original['eventVersion']}
    assert call(viewer,'/api/v1/work/assign',request | {'ownerId':None,'reason':'Unauthorized test'})[0] == 403
    assert call(admin,'/api/v1/work/assign',request | {'reason':'Missing explicit owner'})[0] == 400
    assert call(viewer,'/api/v1/work/review',request | {'actor':'forged'})[0] == 422
    assert call(viewer,'/api/v1/work/review',request | {'eventVersion':0})[0] == 409
    assert call(viewer,'/api/v1/work/review',request,origin=False)[0] == 403
    checks.append('Owner cannot reassign; missing owner, forged actor, stale version and missing origin rejected')
    # Current main keeps native account management. Command-scope denial is
    # exercised by the live Rust work/anchor/pb4t tests using isolated records;
    # this feature does not add the older account-settings HTTP editor.
    with viewer.open(base + '/auth/session', timeout=15) as response:
        session = json.load(response)
    assert session['userId'] == 'demo:dev-user'
    assert session['identity']['role'] == 'viewer'
    assert session['scope']
    checks.append('Native session supplies exact actor and scope cache identity')
    before = call(admin,'/api/v1/work/list')[1]
    after = call(admin,'/api/v1/work/list')[1]
    assert before == after
    assert len(after['items']) == 3
    assert next(task for task in after['items'] if task['id']==original['id'])['reviewFlags']==original['reviewFlags']
    checks.append('Repeated ingestion/list is idempotent and preserves source review flags')
    print(json.dumps({'passed':checks},indent=2))

if __name__ == '__main__':
    main()
