# Mailbox calendar viewer (demo stand-in)

UNCLASSIFIED // FICTIONAL DEMO DATA. Local demo only.

A read-only week view of the stand-in mailbox calendar. The `calendar` service
(Radicale, CalDAV) holds the collection `/sailor/otis/`; this page polls it every
3 seconds and draws a UTC Monday-to-Sunday grid. Events that appear between polls
are highlighted briefly. If the collection does not exist yet, the page says to
click Sync to Outlook in OTIS (the server creates it on first sync).

## Start

From the repository root:

```sh
docker compose -f demo/docker-compose.yml up -d --wait calendar calendar-viewer
```

Open <http://127.0.0.1:1580/>. The port is published on loopback only.

## How it fits together

- `calendar` is reachable on the compose network `mail` as `calendar:5232`. The
  owner is `sailor`; the `owner_only` rights rule limits that user to `/sailor/`.
  Config is in `../calendar/config`; the fictional demo credential is in
  `../calendar/users` (plaintext htpasswd, public, never reuse).
- `calendar-viewer` is `nginx:1.28.0-alpine` with a read-only root filesystem. It
  proxies `/dav/` to `http://calendar:5232/` for GET/HEAD only and adds the Basic
  `Authorization` header itself, so the browser never sees the password. The header
  value is built at container start by `docker-entrypoint.d/16-basic-auth.envsh`
  (from `CALENDAR_USER` plus `CALENDAR_PASSWORD`, or the mounted users file when the
  password is unset) and substituted into `templates/default.conf.template` by the
  nginx image's envsubst step.
- The page (`html/`) is static HTML, CSS and vanilla JS with no external assets.

## Server settings

The Parse Command server writes events with these environment variables (set them
on the server service, not here):

```
PARSE_COMMAND_DEMO_CALENDAR_URL=http://calendar:5232/sailor/otis/
PARSE_COMMAND_DEMO_CALENDAR_USER=sailor
PARSE_COMMAND_DEMO_CALENDAR_PASSWORD=<value from demo/calendar/users>
```

## Try it by hand

```sh
PW=$(sed -n 's/^sailor://p' demo/calendar/users)
docker compose -f demo/docker-compose.yml exec calendar \
  curl -s -u "sailor:$PW" -X MKCALENDAR http://localhost:5232/sailor/otis/
```

Then PUT `.ics` files (one VEVENT each) to `/sailor/otis/<uid>.ics`; they show up
in the viewer within a few seconds.
