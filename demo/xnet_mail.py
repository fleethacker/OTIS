#!/usr/bin/env python3
"""Send only the committed UNCLASSIFIED fictional xnet examples to loopback SMTP.

No credentials, arbitrary files, remote hosts, or inferred recipients are accepted.
Without --send this is a local preview and opens no network connection.
"""
import argparse
from email import policy
from email.parser import BytesParser
from pathlib import Path
import smtplib

FIXTURES = Path(__file__).resolve().parents[1] / "backend/config/xnet-fixtures"
RECIPIENTS = {"HIGH": "high@parse-command.test", "LOW": "low@parse-command.test"}


def selections(only_unstated=False, include_unstated=False):
    if only_unstated:
        return [("HIGH", "high-03-unstated.eml")]
    items = [("HIGH", "high-01.eml"), ("HIGH", "high-02.eml"), ("LOW", "low-01.eml")]
    if include_unstated:
        items.append(("HIGH", "high-03-unstated.eml"))
    return items


def messages(items):
    result = []
    for network, filename in items:
        message = BytesParser(policy=policy.SMTP).parsebytes((FIXTURES / filename).read_bytes())
        if message["To"] != RECIPIENTS[network] or message["From"] != "fictional-desk@parse-command.test":
            raise ValueError("fictional_fixture_destination_mismatch")
        if message["X-Demo-Command-IDs"] != "USS Meridian" or "UNCLASSIFIED" not in message.get_content():
            raise ValueError("fictional_fixture_metadata_mismatch")
        result.append((network, message))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send", action="store_true", help="Deliver to the local demo SMTP service at 127.0.0.1:1025")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--include-unstated", action="store_true")
    group.add_argument("--only-unstated", action="store_true")
    args = parser.parse_args()
    prepared = messages(selections(args.only_unstated, args.include_unstated))
    if not args.send:
        print(f"Preview: {len(prepared)} UNCLASSIFIED fictional messages for HIGH/LOW (fictional); use --send for loopback delivery.")
        return
    with smtplib.SMTP("127.0.0.1", 1025, timeout=10) as smtp:
        smtp.ehlo("sender.parse-command.test")
        for network, message in prepared:
            refused = smtp.send_message(message, from_addr="fictional-desk@parse-command.test", to_addrs=[RECIPIENTS[network]])
            if refused:
                raise RuntimeError("fictional_fixture_delivery_refused")
    print(f"SMTP accepted {len(prepared)} fictional messages; verify custody and publication separately.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, smtplib.SMTPException):
        raise SystemExit("Fictional fixture delivery failed; verify the local mail service and provisioned accounts.") from None
