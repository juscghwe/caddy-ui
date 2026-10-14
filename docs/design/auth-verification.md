# Bootstrap/login verification checkpoint

Branch: `feat/bootstrap-and-login`. Local verification on 2026-10-14 uses Node
24.19.0, Chromium 154 and a managed Linux Docker daemon. Upstream main through
`23d748569a1a22a47cc07623b1762424eb46315a` (#222) is integrated. This records
implementation evidence; it is not an independent security audit or release approval.

## Passed locally

- Backend: 283 tests across 30 files and ESLint. Coverage includes real encrypted
  database/WAL behavior, wrong/missing-key refusal, bootstrap expiry/replay/races,
  Argon2id verification, secure-cookie/CSRF/origin/proxy boundaries, session
  expiry/revocation, last-admin races, preferences, legacy activation, recovery,
  consistent encrypted backups, actual re-encryption, and interrupted transitions.
- Frontend: 35 tests across 8 files, zero-warning ESLint and English catalog
  validation. The existing build completes with its bundle-size warning.
- Three permanent browser scenarios: fresh setup over existing HTTPS, legacy
  activation over existing HTTPS, and two real Caddy instances. They exercise
  one-time vault export, cookie flags, absence of persistent bearer credentials,
  account creation/disablement, password changes, restart/revocation, Caddyfile
  save/download, independent managed-Caddy CA download and the selected live-log
  instance in the actual Logs screen. The browser uses a pin scoped to the minted
  test leaf; Node verifies the test CA chain and rejects the same connection
  without trust. OS/browser CA import itself is not automated.
- Three proxy/deployment checks: broad CIDRs rejected, actual nginx forwarding
  preserves external Host/port and strips untrusted HTTPS headers, and the optional
  Compose topology validates with separate keys and loopback-only setup exposure.
- Twelve disposable-Caddy lifecycle tests and harness lint. Fixtures use isolated
  backend paths and uniquely labeled Caddy containers/volumes; cleanup removes only
  their own resources.
- mdBook build and generated Docker Hub descriptions validate.
- The actual frontend Dockerfile builds with its locked dependency installation,
  and the resulting nginx image passes its entrypoint/configuration smoke check.

Run the browser suite after installing backend/frontend dependencies and generating
the editor mode with `npm run build --prefix frontend`:

```sh
cd frontend
npx playwright install --with-deps chromium
cd ..
CADDY_UI_TEST_DOCKER=true npm run test:auth-browser --prefix frontend
npm run test:auth-proxy
```

An existing Chromium executable can be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. These tests require local TCP listeners,
OpenSSL, and Docker for the real-Caddy/proxy scenarios. The workflow runs them
with Node 24 and includes them in the required Test gate.

## Outstanding image check

The backend Alpine image build cannot complete in this sandbox: outbound access
for `dl-cdn.alpinelinux.org` is denied with HTTP 403, preventing installation of
its existing Docker CLI and new native compilation prerequisites. Native SQLCipher
and Argon2id pass on the local Linux/Node 24 installation, but that does not verify
the Alpine/musl runtime image. No alternate host is used to bypass this restriction.

CI now builds both actual Dockerfiles and runs an encrypted-store/password/session
smoke test inside the backend image. Confirm that CI step or run the image check
locally before release. GitHub CI results have not been observed from this sandbox.

## Deliberate follow-ups

All current accounts are fully trusted administrators. Per-instance roles,
invitations, passkeys/TOTP and scoped machine credentials are outside this branch.
The broader instance-ID fallback/alias policy must be resolved before scoped
permissions. The separate intended-management-versus-SSRF discussion remains
unresolved; this branch does not reintroduce the reverted Caddy admin-origin
allowlist. Encryption protects persisted auth records/backups, while a running
backend necessarily holds its protected runtime key.
