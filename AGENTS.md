# Slim Sales Agent — agent notes

## Cursor Cloud specific instructions

### Product shape

- Vite + React browser app (`npm run dev`, default docs port `4173`) for offline prospect simulation and gated Realtime voice.
- Cloudflare Worker (`worker/`, `npm run worker:dev` after `npm run build`) serves the production assets + authenticated APIs. Local Worker secrets live in `.dev.vars` (never commit). Required secret names are listed in `wrangler.jsonc` / README.
- SwiftUI iOS companion under `ios/` (Xcode / macOS only). This Linux Cloud VM cannot run `xcodebuild` or the iOS Simulator.

### Phone-pilot safety (do not bypass)

- Dialing is owner-initiated to **saved people** (`contactId`) or an **attested new North American number** (`ownerAttestation: true`). No cold sales outbound product mode. Premium / non-`+1` destinations stay rejected.
- `TWILIO_VERIFIED_NUMBER` seeds the default saved contact (Primary) when the owner list is empty; it is not a hidden singleton dial target in the UI.
- SIP objectives require a server-generated single-use claim token carried only on the Twilio→OpenAI SIP path. Never return claim tokens, Twilio credentials, objectives, or destination numbers to browser/iOS recovery responses.
- Browser `POST /api/realtime/release` is scope-bound to `browser` and must never release a phone lease.
- Ambiguous Twilio creation must stay in `provider_unknown` and remain concurrency-counted until terminal reconciliation.
- Do not deploy, place a real call, rename env vars, or enable new external capabilities without explicit owner approval.

### Standard commands

See README / `package.json`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check`.

### Secret-blocking pre-commit hook

`.githooks/pre-commit` refuses any commit containing credential-shaped strings.
It exists because GitHub's secret scanning is a paid add-on on private repos,
and because blocking the commit beats alerting after the push.

**One-time step in every fresh clone**, since `.git/hooks` is not cloned:

```bash
git config core.hooksPath .githooks
```

It covers 16 credential shapes and prints only a 14-character prefix on a hit,
never the value. `git commit --no-verify` bypasses it for test fixtures.

The hook self-tests before certifying a commit: it assembles a known fake key at
runtime and exits 1 with `scanner self-test FAILED` if that does not match. A
scanner whose pattern silently breaks reports every commit as clean, which is
indistinguishable from a clean repo. Do not remove that check, and do not
rewrite the canary as a string literal: a literal is a real match sitting in the
file, which made the hook block its own commit.

Source of truth is `templates/pre-commit` in the private `secret-agent-kit`
repo. Fix bugs there and re-copy, so every project gets the fix.
