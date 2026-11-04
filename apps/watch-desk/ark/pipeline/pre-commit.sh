#!/bin/sh
# Legacy owned-pipeline entrypoint; the canonical hook lives under ark/hooks.
exec "$(dirname "$0")/../hooks/pre-commit" "$@"
