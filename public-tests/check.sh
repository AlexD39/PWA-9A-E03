#!/usr/bin/env bash
set -euo pipefail
test -e 'docs/requirements.md' && test -e 'docs/decision-record.md' && test -e 'package.json' && test -e 'package-lock.json' && test -e 'scripts/verify.mjs'
test -f README.md
! rg -n -i '(api[_-]?key|secret|password|token)' --glob '!public-tests/check.sh' .
echo PUBLIC_OK

