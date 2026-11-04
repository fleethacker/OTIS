#!/usr/bin/env python3
"""Restore only the two ignored reference fixtures from an original Ark export."""
import argparse
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = (
    "internal/service/testdata/structured-messages.json",
    "ui/tests/journey/fixtures/present-extensible-structured-message-cards.json",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    with tarfile.open(args.archive, "r:gz") as archive:
        # Check both entries before writing either; never unpack arbitrary paths.
        members = [archive.getmember(name) for name in FIXTURES]
        if any(not item.isfile() or item.size > 10_000_000 for item in members):
            raise SystemExit("Expected bounded regular fixture files")
        for item in members:
            target = ROOT / "apps/watch-desk" / item.name
            data = archive.extractfile(item).read()
            if target.exists():
                if target.read_bytes() != data:
                    raise SystemExit(f"Refusing to overwrite changed fixture: {item.name}")
                print(f"Already restored: {item.name}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            print(f"Restored ignored fixture: {item.name}")


if __name__ == "__main__":
    main()
