#!/usr/bin/env python3
"""Import consistent, read-only SQLite snapshots into hidden OpenSearch indices.

Stop old writers and use SQLite backup() before the final import. Existing records
must match byte-for-byte after JSON normalization: this never overwrites live state.
The marker is written only after every imported document is read back and verified.
"""
import argparse, base64, collections, hashlib, json, pathlib, sqlite3, urllib.error, urllib.request


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def identity(kind, key):
    return digest((kind + '\0' + key).encode())


def record(kind, key, payload, **values):
    return dict(kind=kind, key=str(key), owner=values.get('owner', ''), source=values.get('source', ''), state=values.get('state', ''), category=values.get('category', ''), flags=values.get('flags', []), order=values.get('order', 0), expires=values.get('expires', 0), available=values.get('available', 0), bytes=values.get('bytes', 0), payload=payload)


def snapshot(path):
    db = sqlite3.connect(pathlib.Path(path).resolve().as_uri() + '?mode=ro&immutable=1', uri=True)
    db.row_factory = sqlite3.Row
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('Invalid SQLite snapshot')
    names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    tables = {name: [dict(row) for row in db.execute('SELECT * FROM "' + name.replace('"', '""') + '"')] for name in names}
    db.close()
    return tables


def owner(name):
    return 'demo:' + name


def convert(private, custody):
    state, queue = [], []
    add = lambda kind, key, payload, **kw: state.append(record(kind, key, payload, **kw))
    put = lambda kind, key, payload, **kw: queue.append(record(kind, key, payload, **kw))
    max_id = max([0] + [r['id'] for r in private.get('identities', [])] + [r['id'] for r in private.get('drafts', [])])
    for row in private.get('identities', []):
        add('identity', row['source_key'], {}, order=row['id'])
    for row in private.get('drafts', []):
        key = owner(row['owner']) + '\0' + row['source_key']
        add('draft', key, {'text': row['text'], 'saved_at': row['saved_at']}, owner=owner(row['owner']), source=row['source_key'], order=row['id'])
        add('identity', 'draft:' + key, {}, order=row['id'])
    add('counter', 'identities', {}, order=max_id)
    histories = collections.defaultdict(list)
    for row in private.get('activity', []):
        histories[(row['owner'], row['source_key'])].append(dict(id=str(row['id']), kind=row['kind'], recorder=owner(row['owner']), recorded_at=row['recorded_at'], occurred_at=row['occurred_at'], note=row['note'], provenance='user-reported'))
    preps = {(r['owner'], r['source_key']): r for r in private.get('preparations', [])}
    for name, key in sorted(set(preps) | set(histories)):
        row = preps.get((name, key), {})
        add('preparation', owner(name) + '\0' + key, {'fields_json': row.get('fields_json', '{}'), 'generated_text': row.get('generated_text', ''), 'acknowledged': bool(row.get('acknowledged', False)), 'history': histories[(name, key)]}, owner=owner(name), source=key)
    users = {r['owner'] for table in ['drafts', 'preparations', 'activity', 'notification_reads', 'notification_inboxes'] for r in private.get(table, [])}
    for name in sorted(users):
        if not name: raise ValueError('Unowned private record requires explicit migration mapping')
        role = 'admin' if name == 'dev-admin' else 'viewer'
        add('user', owner(name), dict(username=name, email='', groups=[role], enabled=True, epoch=0, timezone='UTC', identity_type='demo', created_at='', last_login=''), owner=owner(name), category=role)
    for row in private.get('legacy_messages', []): add('legacy_message', row['source_key'], json.loads(row['document']))
    for row in private.get('legacy_orphans', []): add('legacy_orphan', f"{row['kind']}:{row['id']}", json.loads(row['document']))
    for row in private.get('migration', []): add('legacy_migration', row['id'], row)
    notice_by_id = {r['id']: r for r in private.get('notifications', [])}
    for row in notice_by_id.values():
        members = {m['source_key'].rsplit('@', 1)[0]: dict(messageKey=m['source_key'], subject=m['subject'], context=m['context'], at=m['at'], version=m['version']) for m in private.get('notification_members', []) if m['notification_id'] == row['id']}
        add('notification', row['group_key'], dict(id=row['id'], kind=row['kind'], context=row['context'], messageKey=row['source_key'], at=row['at'], detail=row['detail'], resolvedAt=row['resolved_at'], count=row['count'], members=members), order=row['version'])
        add('notification_id', str(row['id']), {'key': row['group_key']})
    for row in private.get('notification_seen', []): add('notification_seen', row['source_key'].rsplit('@', 1)[0], {'event': 'migrated', 'group': '', 'at': ''})
    for row in private.get('notification_incidents', []):
        notice = notice_by_id[row['notification_id']]
        kind, _, key = row['scope'].partition(':')
        add('notification_incident', kind + '_event:' + key, dict(failure=notice['group_key'], at=notice['at'], detail=notice['detail']), state='open', order=notice['version'])
    for name in sorted(users):
        reads = {str(r['notification_id']): r['version'] for r in private.get('notification_reads', []) if r['owner'] == name}
        through = next((r['read_through'] for r in private.get('notification_inboxes', []) if r['owner'] == name), 0)
        add('notification_reads', owner(name), {'through': through, 'versions': reads}, owner=owner(name))
    for row in private.get('notification_cursors', []): add('notification_cursor', row['stream'] + '_event', {}, order=row['sequence'])
    add('counter', 'notifications', {}, order=max([0] + [r['value'] for r in private.get('notification_clock', [])] + list(notice_by_id)))

    receipts = {r['id']: r for r in custody.get('receipts', [])}
    events = collections.defaultdict(list)
    for event in sorted(custody.get('custody_events', []), key=lambda r: r['sequence']):
        receipt = receipts[event['receipt_id']]
        key = f"{receipt['id']}:{len(events[receipt['id']])}"
        payload = {k: event[k] for k in ['state', 'code', 'at']}
        events[receipt['id']].append(payload)
        source = f"{receipt['body_id']}@{receipt['revision']}" if receipt['body_id'] and receipt['revision'] else ''
        put('custody_event', key, payload, owner=receipt['id'], source=source, category=str(receipt['validity']), state=event['state'], order=event['sequence'])
    audits = collections.defaultdict(list)
    email_audits = collections.defaultdict(list)
    for row in custody.get('audit_outbox', []):
        value = json.loads(row['document'])
        put('audit_archive', row['id'], value, source=f"{row['message_id']}@{row['revision']}", state=row['delivery_state'])
        if value['kind'] == 'email_received': email_audits[row['receipt_id']].append(value)
        else: audits[(row['message_id'], row['revision'])].append(value)
    for row in receipts.values():
        if row['raw'] is not None and row['raw_hash'] != 'sha256:' + digest(row['raw']): raise ValueError('Receipt hash mismatch')
        raw = base64.b64encode(row['raw']).decode() if row['raw'] is not None else None
        payload = {k: row[k] for k in ['validity', 'uid', 'size', 'raw_hash', 'received_at', 'server_received_at', 'attempts', 'code', 'subject']}
        payload.update(raw=raw, metadata=json.loads(row['metadata']) if row['metadata'] else None, events=events[row['id']], audit=email_audits[row['id']], audit_state='queued')
        flags = ['missing_received_time'] if row['server_received_at'] is None else []
        source = f"{row['body_id']}@{row['revision']}" if row['body_id'] and row['revision'] else ''
        put('receipt', row['id'], payload, owner=row['account_id'], source=source, category=str(row['validity']), state=row['state'], order=row['sequence'], flags=flags, bytes=len(encoded(payload)))
    for row in custody.get('identity', []): put('mailbox_identity', row['account_id'], {k: row[k] for k in ['host', 'port', 'username', 'mailbox', 'revision']})
    for row in custody.get('cursors', []): put('mailbox_cursor', f"{row['account_id']}:{row['mailbox']}:{row['validity']}", {'validity': row['validity'], 'mailbox': row['mailbox']}, owner=row['account_id'], order=row['uid'])
    by_sequence = {r['sequence']: r for r in receipts.values()}
    for row in custody.get('projections', []):
        core = json.loads(row['core']); selected = by_sequence[row['selected_sequence']]
        matching = sorted((r for r in receipts.values() if r['body_id'] == row['message_id'] and r['revision'] == row['revision']), key=lambda r: r['sequence'])
        if not matching: raise ValueError('Projection has no receipt')
        payload = dict(core=core, audits=audits[(row['message_id'], row['revision'])], first_receipt=matching[0]['id'], selected_subject=selected['subject'], selected_received_at=selected['server_received_at'], subject_conflict=bool(row['subject_conflict']))
        key=f"{row['message_id']}@{row['revision']}"
        put('projection', key, payload, source=key, state=row['delivery_state'], order=row['selected_sequence'], bytes=len(encoded(payload)))
    for row in custody.get('publication_jobs', []):
        value = json.loads(row['source'])
        message = value.get('id') if row['kind'] == 'message' else value.get('message_id')
        payload = dict(id=row['id'], document=value, checksum=row['checksum'], attempts=row['attempts'], published_at=row['published_at'], in_flight=False, events=[], last_error=row['last_error'])
        put('publication', row['kind'] + ':' + row['id'], payload, owner=row['target'], source=f"{message}@{value.get('revision', '')}", state=row['state'], category=row['kind'], order={'message': 0, 'passage': 1, 'audit': 2, 'enrich': 3}[row['kind']], available=row['next_attempt'], bytes=len(encoded(payload)))
    for row in custody.get('publication_events', []):
        put('publication_event', 'legacy:' + str(row['sequence']), {'state': row['code'], 'at': row['at'], 'code': row['code']}, owner=row['stage'] + ':' + row['job_id'], source=f"{row['message_id']}@{row['revision']}", state=row['code'], category=row['stage'], order=row['sequence'])
    for row in custody.get('publication_indices', []): put('publication_index', row['name'], {'uuid': row['uuid']})
    for kind, table, column in [('receipts', 'receipts', 'sequence'), ('custody_event', 'custody_events', 'sequence'), ('publication_event', 'publication_events', 'sequence')]: put('counter', kind, {}, order=max([0]+[r[column] for r in custody.get(table, [])]))
    def unique(rows):
        result = {}
        for row in rows:
            key = identity(row['kind'], row['key'])
            if key in result and result[key] != row: raise ValueError('Conflicting migration identity')
            result[key] = row
        return list(result.values())
    return unique(state), unique(queue)

class Target:
    def __init__(self, url):
        parsed=urllib.parse.urlparse(url)
        if parsed.scheme not in ('http','https') or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError('Invalid endpoint')
        self.url=url.rstrip('/')
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(self, method, path, data=None, content='application/json'):
        body = data if isinstance(data, bytes) else encoded(data) if data is not None else None
        req=urllib.request.Request(self.url+path, body, {'Content-Type':content}, method=method)
        try:
            with self.opener.open(req, timeout=30) as response: return response.status,json.load(response)
        except urllib.error.HTTPError as error: return error.code,json.load(error)
    def provision(self,index):
        if not index.startswith('.parse-command-') or not all(c in '.-abcdefghijklmnopqrstuvwxyz0123456789' for c in index): raise ValueError('Invalid hidden index name')
        definition=json.loads((pathlib.Path(__file__).parents[1]/'crates/parse-command-state/state-index.json').read_text())
        code,value=self.request('PUT','/'+index,definition)
        if code not in (200,201) and value.get('error',{}).get('type')!='resource_already_exists_exception': raise ValueError('Cannot provision hidden index')
        code,value=self.request('GET','/'+index)
        actual=value.get(index,{})
        if actual.get('settings',{}).get('index',{}).get('hidden')!='true' or actual.get('mappings')!=definition['mappings']: raise ValueError('Target schema mismatch')
    def import_verify(self,index,rows):
        for offset in range(0,len(rows),50):
            batch=rows[offset:offset+50]
            lines=[]
            for row in batch: lines += [encoded({'create':{'_index':index,'_id':identity(row['kind'],row['key'])}}),encoded(row)]
            code,value=self.request('POST','/_bulk',b'\n'.join(lines)+b'\n','application/x-ndjson')
            if code!=200 or len(value.get('items',[]))!=len(batch) or any(item['create']['status'] not in (201,409) for item in value['items']): raise ValueError('Import write failed; safe to retry')
            code,value=self.request('POST','/'+index+'/_mget',{'ids':[identity(r['kind'],r['key']) for r in batch]})
            if code!=200 or len(value.get('docs',[]))!=len(batch): raise ValueError('Import verification failed')
            for expected,actual in zip(batch,value['docs']):
                if encoded(actual.get('_source')) != encoded(expected): raise ValueError('Existing target differs: '+expected['kind']+'; refusing overwrite')
        self.request('POST','/'+index+'/_refresh')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--private',required=True);p.add_argument('--custody',required=True)
    p.add_argument('--url',default='http://127.0.0.1:9200');p.add_argument('--state-index',required=True);p.add_argument('--custody-index',required=True);p.add_argument('--apply',action='store_true')
    args=p.parse_args();private=snapshot(args.private);custody=snapshot(args.custody)
    state,queue=convert(private,custody)
    fingerprint=digest(pathlib.Path(args.private).read_bytes()+pathlib.Path(args.custody).read_bytes())
    report={'snapshot_sha256':fingerprint,'source_counts':{'private':{k:len(v) for k,v in private.items()},'custody':{k:len(v) for k,v in custody.items()}},'records':{'private':len(state),'custody':len(queue)},'content_sha256':{'private':digest(encoded(state)),'custody':digest(encoded(queue))},'invalidated':['sessions','read_windows','cursors (private only)']}
    if args.apply:
        target=Target(args.url)
        for index,rows in [(args.state_index,state),(args.custody_index,queue)]:
            target.provision(index);target.import_verify(index,rows)
        for index in [args.state_index,args.custody_index]: target.import_verify(index,[record('migration','sqlite-to-opensearch-v1',report,state='complete')])
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
