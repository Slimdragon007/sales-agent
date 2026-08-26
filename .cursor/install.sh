#!/usr/bin/env bash
# Cloud agent install script. Must be idempotent: Cursor reruns it on partially
# cached state.
set -euo pipefail

# Secrets are optional. The test suite supplies fabricated bindings via
# vitest.config.ts, so lint, typecheck, test and build all pass with nothing
# configured. Only deploying or placing a real call needs the real values.
# So a missing token degrades to "can build and test", never to a hard failure.
#
# Cursor may inject the vault token as OP_SERVICE_ACCOUNT_TOKEN (the documented
# name) or as "1password" (a dashboard label). Bash cannot expand ${1password}
# because names must start with a letter or underscore — always read via
# printenv, never via ${...}.
resolve_op_token() {
  local token
  token="$(printenv OP_SERVICE_ACCOUNT_TOKEN 2>/dev/null || true)"
  if [ -z "$token" ]; then
    token="$(printenv 1password 2>/dev/null || true)"
  fi
  printf '%s' "$token"
}

OP_TOKEN="$(resolve_op_token)"

if [ -n "$OP_TOKEN" ]; then
  export OP_SERVICE_ACCOUNT_TOKEN="$OP_TOKEN"

  if ! command -v op >/dev/null 2>&1; then
    OP_VER=2.31.1
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64)  OP_ARCH=amd64 ;;
      aarch64) OP_ARCH=arm64 ;;
      *)       echo "unsupported arch $ARCH, skipping op install" >&2; OP_ARCH="" ;;
    esac
    if [ -n "$OP_ARCH" ]; then
      curl -sSfLo /tmp/op.zip \
        "https://cache.agilebits.com/dist/1P/op2/pkg/v${OP_VER}/op_linux_${OP_ARCH}_v${OP_VER}.zip"
      sudo unzip -oqd /usr/local/bin /tmp/op.zip op
      rm -f /tmp/op.zip
    fi
  fi

  if command -v op >/dev/null 2>&1; then
    if grep -q 'op://' .cursor/secrets.tpl; then
      # .dev.vars is what wrangler reads locally, and .gitignore already excludes it.
      op inject -i .cursor/secrets.tpl -o .dev.vars -f
      chmod 600 .dev.vars
      echo "secrets injected into .dev.vars"

      # A placeholder is truthy. worker/index.ts guards with Boolean(env.X) and
      # `env.X?.trim() ?? ""`, so a literal FILL_ME passes every check and the
      # app reports itself configured while holding nothing usable. Blank those
      # values so presence checks fail closed, and name them loudly so the owner
      # knows which vault fields still need real credentials.
      if grep -q '=FILL_ME$' .dev.vars; then
        echo "WARNING: these variables are placeholders, not real credentials:" >&2
        grep '=FILL_ME$' .dev.vars | cut -d= -f1 | sed 's/^/           /' >&2
        echo "         Blanking them in .dev.vars so the app fails closed." >&2
        echo "         Fill the matching secret names in the private vault." >&2
        # Rewrite FILL_ME -> empty without printing any secret values.
        #
        # Not `sed -i`: GNU accepts a bare -i, BSD reads the next argument as a
        # backup suffix. This script runs on Ubuntu in the cloud and on macOS
        # locally, and under `set -e` the BSD failure aborts before npm ci.
        # Not `sed -i.bak` either: portable, but it leaves a backup holding every
        # real credential beside a .gitignore entry that only covers .dev.vars.
        blanked="$(mktemp)"
        chmod 600 "$blanked"
        sed 's/=FILL_ME$/=/' .dev.vars > "$blanked"
        mv "$blanked" .dev.vars
        chmod 600 .dev.vars
      fi
    else
      echo "secrets.tpl lists names only; skipping vault inject."
      echo "Provide gitignored .dev.vars or .env.local for live Worker calls."
    fi
  fi
else
  echo "OP_SERVICE_ACCOUNT_TOKEN not set: skipping secret injection."
  echo "Build and test still work; deploy and live calls will not."

  # Cursor reruns this script on cached state, so a .dev.vars written by an
  # earlier run survives when injection is skipped. Those values are never
  # refreshed and may have been rotated or revoked since. Not deleted, because
  # this script also runs on a developer machine where the file may be
  # hand-maintained.
  if [ -f .dev.vars ]; then
    echo "WARNING: .dev.vars exists from an earlier run and was NOT refreshed." >&2
    echo "         Its values may be stale or revoked. Do not trust them." >&2
  fi
fi

# Drop the vault token before running any project code.
#
# npm executes lifecycle scripts, including ones belonging to transitive
# dependencies, and every child process inherits the environment. This token is
# Personal-scoped, so leaving it exported hands a single compromised dependency
# a credential for every item the service account can reach. The injected file
# is already written; nothing below this line needs the token.
#
# Use `env -u` rather than `unset`: the Cursor alias "1password" is not a valid
# bash identifier, so `unset 1password` / `${1password}` cannot clear it.
env -u OP_SERVICE_ACCOUNT_TOKEN -u 1password npm ci
