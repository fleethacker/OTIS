#!/bin/sh
set -eu
"$1" ./...
"$2" fs --config "$3/trivy.yaml" --ignorefile "$3/trivy-ignore" --skip-dirs ark --scanners vuln --exit-code 1 --severity HIGH,CRITICAL --quiet .
