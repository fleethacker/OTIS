# Parse Command mail demo

This is the upstream mailbox for the future Rust intake service: SMTP delivers
email to Postfix, and Parse Command reads Dovecot's `INBOX` over IMAP. Mail and IMAP
UID state persist in Docker volumes. It follows the repository's
[IMAP intake plan](../docs/planning/implementation-plan.md#3-design-and-implement-durable-email-intake)
and [email framing contract](../docs/ICD.md#21-email-subject-and-wrapper-boundary).
The Rust intake service and parser are not implemented by this demo.

## Start and verify

From the repository root, with Docker Compose and Python 3.9+ installed:

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
python3 demo/mail.py check
python3 demo/mail.py inbox
```

The mailbox is preconfigured; no DNS records, Outlook installation, Microsoft
account, or account creation step is needed. The check sends one synthetic
transport probe, verifies its SMTP-to-IMAP round trip, decoded UTF-8 subject,
byte-exact body, stable UID/UIDVALIDITY across reconnect, and unread status. It
leaves the probe in the inbox. It does not validate USMTF parsing.

| Setting | From the host | From a container on `parse-command-demo_mail` |
| --- | --- | --- |
| SMTP delivery | `127.0.0.1:1025` | `mailserver:25` |
| IMAP retrieval | `127.0.0.1:1143` | `mailserver:143` |
| IMAP security | Plaintext, no STARTTLS | Plaintext, no STARTTLS |
| IMAP authentication | Username/password LOGIN | Username/password LOGIN |
| Username / recipient | `inbox@parse-command.test` | `inbox@parse-command.test` |
| Password | `ParseCommandDemoOnly123!` | `ParseCommandDemoOnly123!` |
| Mailbox | `INBOX` | `INBOX` |

These are public demo credentials. SMTP accepts unauthenticated delivery only
to configured local recipients; IMAP requires login. Published ports bind to
loopback, and Postfix rejects delivery to external recipients. TLS is deferred
here as explicitly permitted for v1.

This Compose project is independent of the root OpenSearch project. A future
Rust container can join the existing external network `parse-command-demo_mail`
and use the internal endpoints above; it can also join the OpenSearch network.
Use IMAP account identity, mailbox, UIDVALIDITY and UID for intake cursors, and
`BODY.PEEK[]` for reads. Do not use message sequence numbers as durable cursors or
delete upstream mail as part of polling.

## Send representative messages

Keep operational examples in the external `../OPTASK_Messages` directory, per
the repository's fixture policy. Supply one or more UTF-8 body files:

```sh
python3 demo/mail.py send /absolute/path/to/OPTASK-example.txt \
  --subject 'SUBJ: DEMO OPTASK exercise'
python3 demo/mail.py inbox --limit 20
```

Shell globs may select multiple files for a burst. Each file becomes a separate
email with a new Internet Message-ID. The decoded body must start with `MSGID`.
The helper uses base64 MIME transfer encoding to preserve the file's exact bytes,
including whitespace and its original line endings. Subjects must start with
`SUBJ:`; without `--subject`, the helper supplies `SUBJ: DEMO <filename stem>`.
That subject is explicitly demo metadata, not a recovered original email header.
Running `send` again creates new receipts for the same bodies, useful for testing
the host's eventual deduplication policy.

Python uses only its standard library. Its commands target this local plaintext
demo, not production credentials. `--host`, `--smtp-port`, and `--imap-port` go
before the subcommand if you need different local endpoints.

## Persistence and troubleshooting

```sh
docker compose -f demo/docker-compose.yml ps
docker compose -f demo/docker-compose.yml logs --tail 100 mailserver
docker compose -f demo/docker-compose.yml restart mailserver
python3 demo/mail.py inbox
```

Compare the UIDVALIDITY, UIDs, Message-IDs and unread flags before and after a
restart. `docker compose -f demo/docker-compose.yml down` stops/removes containers
and the network while retaining mailbox volumes. Bringing it up again must show
the same receipts. Adding `--volumes` to `down` deliberately erases the demo
mailbox and its UID state; do that only when a clean inbox is intended.

The supplied `config/postfix-accounts.cf` supplies the demo account and a salted
password hash. `config/postfix-main.cf` removes external DNS checks for local
exercise delivery and rejects external relay destinations. A one-shot `mail-config`
service copies these files into a named configuration volume before the server
starts. Generated configuration stays in that volume, outside the repository.
The upstream image supplies the
service health check. Its configuration and account format are described in the
[Docker Mailserver documentation](https://docker-mailserver.github.io/docker-mailserver/latest/config/account-management/provisioner/file/).
After editing the supplied configuration, use `docker compose -f
demo/docker-compose.yml up -d --force-recreate --wait --wait-timeout 180` to
rerun configuration seeding and startup setup; a plain restart skips that setup.

## Match to Outlook / Exchange production

Outlook is the mail client; the production mailbox service may be Microsoft 365
(Exchange Online) or on-premises Exchange. This demo exercises the repository's
confirmed SMTP-delivery / IMAP-retrieval interface, including MIME, folders,
unread flags, and stable receipt identifiers. It does not emulate Exchange APIs,
Microsoft Graph, Entra token issuance, or Microsoft-specific server behavior.

For Exchange Online, the production adapter must use verified TLS and Microsoft
Entra OAuth2 tokens through IMAP SASL XOAUTH2, with IMAP access enabled and the
required mailbox permissions. A password LOGIN success here does not validate
Microsoft 365 authentication. See
[Microsoft's IMAP OAuth guide](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).
For on-premises Exchange, confirm the organization's IMAP endpoint, certificate
trust roots, and authentication policy. Keep authentication and transport
configuration outside domain parsers. Actual Microsoft authentication must be
tested against the intended deployment before production acceptance.

The repository requires airgapped runtime. An Exchange Online deployment would
need an explicitly approved connectivity architecture; an enclave-local Exchange
server fits that boundary directly. This demo needs no Microsoft connection.

## Offline preparation

During connected preparation, fetch and export the pinned image:

```sh
docker pull ghcr.io/docker-mailserver/docker-mailserver:16.0.1
docker save -o /tmp/parse-command-demo-mailserver.tar \
  ghcr.io/docker-mailserver/docker-mailserver:16.0.1
```

Transfer the archive and this repository to the demo machine, then:

```sh
docker load -i /path/to/parse-command-demo-mailserver.tar
docker compose -f demo/docker-compose.yml up -d --pull never --wait --wait-timeout 180
```

The mail server has update, antivirus, spam, and external reputation checks
disabled. Its bridge network supports host access; runtime network isolation is
provided by the demo host/enclave. Offline first-start acceptance
should still be performed on the target host; no airgap certification is implied.
