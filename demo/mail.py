#!/usr/bin/env python3
"""SMTP injection and non-destructive IMAP checks for the local demo (stdlib only)."""

import argparse
import email.policy
import imaplib
import json
import os
from pathlib import Path
import smtplib
import sys
import time
from email import message_from_bytes
from email.message import EmailMessage
from email.utils import formatdate, make_msgid


USERNAME = "inbox@parse-command.test"
PASSWORD = "ParseCommandDemoOnly123!"
SENDER = "exercise-control@parse-command.test"


def make_message(body, subject):
    body.decode("utf-8")  # Fail before delivery on an unsupported source encoding.
    if not body.startswith(b"MSGID"):
        raise ValueError("The source body must begin with MSGID (see docs/ICD.md).")
    if not subject.startswith("SUBJ:"):
        raise ValueError("The demo email subject must begin with SUBJ:.")
    message = EmailMessage(policy=email.policy.SMTP)
    message["From"] = SENDER
    message["To"] = USERNAME
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain="parse-command.test")
    # The bytes overload preserves source whitespace and line endings exactly;
    # the string overload would append a newline when the file has none.
    message.set_content(
        body, maintype="text", subtype="plain", cte="base64",
        params={"charset": "utf-8"},
    )
    return message


def deliver(args, message):
    with smtplib.SMTP(args.host, args.smtp_port, timeout=10) as smtp:
        smtp.ehlo("sender.parse-command.test")
        refused = smtp.send_message(message)
        if refused:
            raise RuntimeError(f"SMTP refused recipients: {refused}")


def open_inbox(args):
    client = imaplib.IMAP4(args.host, args.imap_port, timeout=10)
    try:
        client.login(USERNAME, PASSWORD)
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("Could not open INBOX read-only.")
    except Exception:
        client.logout()
        raise
    return client


def uidvalidity(client):
    _, data = client.response("UIDVALIDITY")
    if not data or data[0] is None:
        raise RuntimeError("Server did not supply UIDVALIDITY.")
    return data[0].decode("ascii")


def fetch(client, uid, query):
    status, data = client.uid("FETCH", uid, query)
    if status != "OK":
        raise RuntimeError(f"IMAP UID FETCH failed for {uid!r}.")
    for item in data:
        if isinstance(item, tuple):
            return item[0], message_from_bytes(item[1], policy=email.policy.default)
    raise RuntimeError(f"Message UID {uid!r} disappeared during fetch.")


def send(args):
    # Prepare the entire batch before sending so bad input does not partially load it.
    messages = [
        (path, make_message(path.read_bytes(), args.subject or f"SUBJ: DEMO {path.stem}"))
        for path in args.files
    ]
    for path, message in messages:
        deliver(args, message)
        print(json.dumps({"file": str(path), "message_id": str(message["Message-ID"])}))


def inbox(args):
    with open_inbox(args) as client:
        validity = uidvalidity(client)
        status, data = client.uid("SEARCH", None, "ALL")
        if status != "OK":
            raise RuntimeError("IMAP UID SEARCH failed.")
        messages = []
        for uid in data[0].split()[-args.limit:]:
            metadata, message = fetch(
                client, uid, "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM MESSAGE-ID)])",
            )
            messages.append({
                "uid": uid.decode("ascii"),
                "subject": str(message.get("Subject", "")),
                "message_id": str(message.get("Message-ID", "")),
                "flags": [flag.decode("ascii") for flag in imaplib.ParseFlags(metadata)],
            })
        print(json.dumps({"mailbox": "INBOX", "uidvalidity": validity,
                          "messages": messages}, indent=2, ensure_ascii=False))


def check(args):
    # Synthetic transport probe, not an operational or parser acceptance fixture.
    # No terminal newline: exercise exact MIME source preservation as well.
    body = b"MSGID/TRANSPORT-TEST/DEMO//\r\nTransport check: caf\xc3\xa9."
    subject = "SUBJ: Demo transport \u2013 caf\u00e9"
    message = make_message(body, subject)
    deliver(args, message)
    deadline = time.monotonic() + 30
    with open_inbox(args) as client:
        validity = uidvalidity(client)
        while True:
            status, data = client.uid(
                "SEARCH", None, "HEADER", "Message-ID", f'"{message["Message-ID"]}"',
            )
            if status != "OK":
                raise RuntimeError("IMAP UID SEARCH failed.")
            uids = data[0].split()
            if uids:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("SMTP accepted the probe but it did not reach INBOX within 30s.")
            time.sleep(0.25)
        if len(uids) != 1:
            raise RuntimeError("Expected exactly one receipt of this unique transport probe.")
        uid = uids[0]
        metadata, received = fetch(client, uid, "(UID FLAGS BODY.PEEK[])")
        if str(received["Subject"]) != subject:
            raise RuntimeError("Encoded email subject changed during delivery.")
        if received.get_payload(decode=True) != body:
            raise RuntimeError("Decoded body bytes changed during delivery.")
        if b"\\Seen" in imaplib.ParseFlags(metadata):
            raise RuntimeError("Reading the probe unexpectedly marked it Seen.")
    # A fresh connection must find the same persisted receipt identity.
    with open_inbox(args) as client:
        if uidvalidity(client) != validity:
            raise RuntimeError("UIDVALIDITY changed across reconnect.")
        metadata, received = fetch(client, uid, "(UID FLAGS BODY.PEEK[])")
        if str(received["Message-ID"]) != str(message["Message-ID"]):
            raise RuntimeError("UID resolved to a different receipt after reconnect.")
        if b"\\Seen" in imaplib.ParseFlags(metadata):
            raise RuntimeError("Probe was marked Seen after reconnect.")
    print(json.dumps({"result": "ok", "mailbox": "INBOX", "uidvalidity": validity,
                      "uid": uid.decode("ascii"), "message_id": str(message["Message-ID"]),
                      "checks": ["SMTP delivery", "IMAP login", "UID SEARCH/FETCH",
                                 "UTF-8 subject", "exact decoded body bytes",
                                 "BODY.PEEK leaves unread", "receipt survives reconnect"]}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("DEMO_MAIL_HOST", "127.0.0.1"))
    parser.add_argument("--smtp-port", type=int, default=1025)
    parser.add_argument("--imap-port", type=int, default=1143)
    commands = parser.add_subparsers(dest="command", required=True)
    sender = commands.add_parser("send", help="Wrap external UTF-8 USMTF files as emails and send via SMTP")
    sender.add_argument("files", nargs="+", type=Path)
    sender.add_argument("--subject", help="Email subject, including the leading SUBJ: marker")
    sender.set_defaults(run=send)
    reader = commands.add_parser("inbox", help="List recent INBOX receipts without marking them read")
    reader.add_argument("--limit", type=int, default=10)
    reader.set_defaults(run=inbox)
    commands.add_parser("check", help="Send a synthetic probe and verify its IMAP round trip").set_defaults(run=check)
    args = parser.parse_args()
    if args.command == "inbox" and args.limit < 1:
        parser.error("--limit must be positive")
    try:
        args.run(args)
    except (OSError, ValueError, RuntimeError, smtplib.SMTPException, imaplib.IMAP4.error) as error:
        print(f"Demo mail error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
