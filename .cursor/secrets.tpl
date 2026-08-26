# Secret names, not secrets. Safe to commit.
#
# Each name below is exactly the `secrets.required` list in wrangler.jsonc.
# Keep them in sync: a name here that wrangler does not require is dead weight,
# and one wrangler requires that is missing here fails at runtime, not at boot.
#
# Values are injected at boot from a private vault or gitignored `.dev.vars` /
# `.env.local`. This file lists names only — no vault item identifiers, UUIDs,
# or filesystem paths.
#
# This file is NOT named .env.tpl on purpose. The repo .gitignore excludes
# `.env.*` so that name is silently untracked, and the template would never
# reach the cloud agent that needs it.
#
# `op inject` substitutes inside comments too. Do not write a complete vault
# reference in these notes or it will be resolved and can fail the run.
#
# Fields that still say FILL_ME in a local vault inject as the literal string
# FILL_ME. install.sh blanks those after inject so the Worker fails closed
# instead of treating a placeholder as a real credential.

OPENAI_API_KEY=
OPENAI_PROJECT_ID=
OPENAI_WEBHOOK_SECRET=
PREVIEW_PASSWORD=
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_FROM_NUMBER=
TWILIO_VERIFIED_NUMBER=
