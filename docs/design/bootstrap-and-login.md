# Secure bootstrap and administrator login

Status: implementation plan, not shipped behavior.

Branch: `feat/bootstrap-and-login`, created from upstream `main` at
`07af6c35ed605f5f5f30c66970ca509d4dc0b951` (#221).

## Scope and release boundary

Deliver HTTPS onboarding, persistent administrator accounts, hashed passwords,
revocable browser sessions, and local recovery. Per-instance operator/viewer roles
are a follow-up, as agreed with the contributor. Prepare identities and storage
for that extension without presenting permissions that are not enforced.

This is a change to authentication defaults and deployment requirements. Release
it with an explicit upgrade guide and a breaking-change PR title. Merge #222
before implementing frontend changes and adopt #223's integration/browser harness
when available; rebase this branch onto their merged versions rather than copying
their commits or replacing their diagnostic contracts.

The planning commit introduces no runtime changes. Implementation commits should
remain buildable and include tests and documentation for their behavior. The
authentication transition is eligible for release only after the complete flow,
migration, recovery, and adversarial tests work together.

## Findings in the current code

- `backend/src/middleware/auth.js` disables auth unless all three legacy
  environment variables are present. It verifies JWTs without loading a user or
  checking whether an account/session was disabled.
- `backend/src/routes/auth.js` compares a password with its original environment
  value. JWTs are issued at login; `JWT_SECRET` is a static signing key, not a
  user's session token.
- `frontend/src/utils/api.js` stores tokens in localStorage. Logs, Caddyfile
  downloads, and the TLS CA download put tokens in URLs.
- The shipped frontend nginx configuration is HTTP, and the README publishes
  both frontend and backend ports. The backend trusts one proxy hop and enables
  broad CORS; neither is a sufficient policy for trusted HTTPS forwarding.
- `/api/tls/ca` downloads the selected managed Caddy instance's local CA. It is
  authenticated and is not necessarily the CA for caddy/ui's own web origin.
- Preferences and operational settings currently share `settings.json`.
  `firstTimeRun` controls a welcome dialog, not authentication initialization.
- `getInstance(id)` falls back to the first instance for unknown IDs, and some
  instance routes return or probe every registered instance. These need explicit
  review before per-instance permissions are introduced.
- The backend image uses Node 24 Alpine; existing CI uses Node 22. Choose and
  validate database/password dependencies against both, or deliberately align
  supported runtimes first.

## Security and usability requirements

Normal account creation, setup-code submission, login, authenticated requests,
downloads, and live streams require HTTPS at the browser-facing origin. Passwords
may be submitted in a POST body over HTTPS; do not put credentials in URLs or
invent an application encryption protocol.

An installation already behind trusted HTTPS goes straight to the one-time code
exchange and initial administrator creation. Do not create a new CA, replace its
certificate, require a download, install an extra gateway, or change its existing
proxy just because the account database is uninitialized.

The HTTP setup surface serves instructions and public certificate material only.
It cannot accept a setup code/password, issue a session, modify accounts, expose
instance configuration, or perform management operations. Show this message:

> This connection uses HTTP. Passwords and session credentials can be intercepted.
> Configure HTTPS before signing in or managing Caddy.

Installing trust remains an explicit browser/OS action. Explain it with concrete
steps rather than requiring prior PKI knowledge. Neither a page's fingerprint nor
a one-time setup code independently proves the authenticity of a certificate
downloaded through that same HTTP page.

Authentication defaults to required. An explicitly configured disabled mode may
remain for isolated development/trusted deployments, clearly marked as providing
no account protection. Missing variables, failed migrations, unreadable storage,
or missing keys must never select that mode. Partial/conflicting legacy auth
configuration is an actionable startup error even if a bypass was requested.

## Storage and credential design

Use encrypted SQLite by default for the initial single-backend deployment,
behind a small repository layer and versioned migrations. Prefer SQLCipher
Community, which provides AES-256 database encryption under a BSD-style
[open-source license](https://github.com/sqlcipher/sqlcipher/blob/master/LICENSE.md).
It does not require a commercial SEE license. Verify the selected Node adapter
and crypto dependencies have compatible licenses too.

SQLite provides transactions, unique constraints, foreign keys, and consistent
updates without making users administer a second service. Use prepared
statements, enable foreign keys, bound lock waits, and verify durability and WAL
behavior on the supported persistent volume.

A database file is still a file on a server. Core SQLite has no built-in AES
encryption; the application must ship a verified encryption-capable provider.
Encryption protects an obtained database/backup, not a compromised running
host/backend with access to its keys. Restrict the auth directory to the service
identity (target mode 0700) and the database and related files to 0600, exclude
them from source control, and support consistent protected backups. Do not place
SQLite on a network share or claim multiple backend replicas are supported.
PostgreSQL/shared session storage is a later deployment decision if replicas
become a requirement.

Proposed default: a dedicated auth directory under `/etc/caddy-ui/auth/`, separate
from existing Caddy instance/settings/history data. Final configuration names
belong in the implementation and README, not unimplemented product reference.

| Record | Purpose and constraints |
| --- | --- |
| `users` | Stable opaque ID; unique normalized login name; display name; enabled state; administrator role; authentication revision; creation/update timestamps. Document name normalization before applying its unique constraint. |
| `password_credentials` | One password verifier per user, with cascading user ownership, an encoded Argon2id hash containing salt/parameters, and a change timestamp. Never store the original password. |
| `sessions` | SHA-256 digest of a cryptographically random session ID; user ID; captured auth revision; creation, last-use, idle-expiry and absolute-expiry timestamps; minimal metadata for session management. Never store the usable session ID. |
| `bootstrap_state` | A singleton lifecycle record; initialization state; digest and expiry of the current setup challenge; bounded attempts and completion metadata. Creation of the first administrator and completion of setup are one transaction. |
| `user_preferences` | User-owned theme, language, palettes and display preferences. Operational checks and shared notification configuration remain deployment data. |
| `security_audit` | Redacted actor/action/target/result/time/request-ID records for account changes, sessions, bootstrap and local recovery. Access is administrative; retention is bounded. |
| `schema_migrations` | Applied schema versions. Refuse incompatible versions or failed migrations; take a consistent backup before an upgrade. |

Argon2id is the password verifier, not encryption: use unique random salts and
encoded parameters, benchmark a reviewed library on the supported image, and
rehash on successful login when policy changes. Bound input sizes and concurrent
verification work; rate-limit by source and account, use generic failure messages,
and avoid revealing whether a login name exists. Password changes and account
disablement invalidate existing sessions.

Configure and verify the encryption provider before the first schema/data write.
Check provider capability, database readability with the correct key, and failure
with no/wrong key. Stock SQLite can ignore unsupported pragmas, so executing
`PRAGMA key` without checking the provider is not evidence of encryption. Verify
protection of WAL/journal/temp data and migration/backup exports. No plaintext
fallback if the provider or key is missing, and no automatic creation of a new
database when an existing encrypted database cannot be opened.

For a fresh deployment, provision a cryptographically random database key (at
least 256 bits) through the local setup flow before creating the database. Normal
startup obtains it from a protected deployment secret or separately persisted,
restricted key location. Do not put it into source control, container images,
the database directory, logs, or the same backup as the encrypted database.
Key storage must survive container recreation without prompting on every restart.
An initialized deployment missing its key enters local recovery; it must not
generate a replacement key silently.

Volume and backup protection remain necessary. Future TOTP secrets require
recoverable encryption with a separately managed key; passkey public keys do not.
Database encryption does not replace Argon2id or session-ID hashing.

### Deployment encryption recovery

During verified HTTPS setup, offer the deployment owner a separate, randomly
generated recovery code (at least 256 bits of entropy) to save in their vault or
password manager. Deliver it only in the successful HTTPS setup response, with
`Cache-Control: no-store`; do not expose a later retrieval/download endpoint.
The setup view offers a user-controlled export using the value temporarily held
in memory, with deployment identity and the canonical HTTPS URL so the owner can
identify the entry. Export the recovery code, not the raw database key.

Ask the owner to confirm saving it, then clear the transient view state and revoke
any temporary download object URL when the view is dismissed. Never persist the
code in browser storage, URLs, logs or telemetry, and never automatically send it
to a third-party vault service. Reloading the view must not retrieve the code
again. Local regeneration is the recovery path if delivery fails after setup
commits; it does not reopen claiming or reveal the previous code. Keep this code
distinct from the expiring administrator claim code and from any future user's
account-reset codes.

Use a reviewed authenticated wrapping implementation to encrypt a recovery copy
of the database key under a key derived from that high-entropy recovery code.
Persist the encrypted recovery bundle outside the encrypted database, with
version/deployment metadata and the required non-secret derivation parameters.
Include the bundle in the protected backup: it must remain readable while the
database is locked, but it must not contain the plaintext recovery code/key.
Hashing the recovery code alone would not allow recovery of the database key.

Recovery requires the saved code, the bundle, and the database/backup. Require
local control of the deployment for recovery, replace the missing runtime key
securely, and invalidate sessions/challenges. The recovery code is a deployment
master secret; administrator account creation does not automatically grant every
administrator a copy. It cannot recover lost data without a backup.

After recovery, replace the recovery code/bundle. Offline copies cannot be made
provably single-use: re-key the database when compromise of a recovery code is
suspected, and explain that retained old backups remain decryptable with their
old keys. Rotation and backup retention need an explicit operator procedure.

Choose the SQLCipher-compatible adapter and Argon2id implementation before adding
dependencies: verify maintained releases, supported Node versions, Alpine/musl availability,
install behavior, resource usage, and migration/backup support. Avoid assuming a
built-in API has identical support in Node 22 and 24.

## Bootstrap and transport

Keep a defined lifecycle: `uninitialized -> setup pending -> initialized`.
Account deletion, a missing database, or a migration error cannot implicitly
reopen setup. Keep an installation marker independent of the database to detect
its disappearance on an initialized volume; resetting state requires an explicit
local operator command. Missing the whole volume is a recovery/redeployment case,
not an excuse to expose management without auth.

1. Start the app with management locked. Create a cryptographically random setup
   code (at least 128 bits of entropy) through a local CLI/startup flow; persist
   only its digest and expiration. Print it to operator output, not
   application-log APIs. Rate-limit attempts;
   expire it quickly and invalidate it on completion or explicit regeneration.
2. Print the canonical URL and assess transport separately from account state.
   If the setup request is already HTTPS directly or through configured trusted
   forwarding, show the code/administrator form immediately. Existing HTTPS
   needs no certificate/gateway steps. The browser's URL can guide presentation;
   the backend's transport/origin checks remain authoritative. Do not accept an
   arbitrary forwarded header or fetch a user-supplied URL to establish trust.
3. Only when HTTPS is missing, offer a temporary HTTP instruction/certificate
   listener. Default binding is loopback; remote/LAN exposure is explicit and
   narrowly routed. Publishing a separate setup port is a deployment option, not the security
   boundary. No management API is forwarded from it.
4. For the HTTPS installation path, let the administrator choose configuring a
   trusted TLS proxy, an ACME certificate for a domain they control, or an opt-in
   Caddy gateway with its own persistent internal CA. The gateway serves caddy/ui
   independently of managed Caddy configuration; never rewrite the user's managed
   Caddyfile automatically.
5. For newly provisioned internal TLS, print the app CA's SHA-256 fingerprint
   using one documented encoding (DER), and a local export command. Export/download
   only the public CA certificate. Verify its fingerprint against the CLI output
   or transfer it through an independently trusted channel, then install trust on
   the client. Show OS/browser-specific
   guidance; do not present bypassing certificate warnings as completed setup.
6. Through HTTPS, submit the code and create the first administrator. Enforce the
   initialized guard, create the account, consume the code, and persist completion
   atomically so simultaneous claims cannot create two initial administrators.
   Give the deployment owner the separately generated encryption recovery code
   once over this verified connection, with a vault/password-manager export and
   save confirmation in the setup view. Define a crash-safe local regeneration flow so
   losing the response cannot leave the owner without a recovery option or reopen
   administrator claiming.
7. Close the temporary listener and remove bootstrap mutation routes from normal
   operation. New devices/users receive the public certificate via the operator's
   export flow; adding a device never reopens administrator bootstrap.

The backend can receive HTTP from a trusted local proxy. Check HTTPS based on
direct TLS or explicitly trusted proxy identities, with a fixed external origin.
Remove unconditional `trust proxy: 1`. Strip client-supplied forwarding headers at
the edge; preserve the original HTTPS scheme only across configured trusted hops.
Account for the gateway -> nginx -> backend path: blindly using nginx's HTTP
`$scheme`, or trusting an arbitrary incoming `X-Forwarded-Proto`, is incorrect.
Use an explicit origin for redirects and validation, not untrusted Host headers.

Default Compose exposes the chosen web edge, not the raw backend port. Existing
remote/direct-API deployments need a documented secure migration, and deployments
using an already configured proxy must not acquire a mandatory extra gateway.
Persist and renew gateway TLS material without regenerating its CA on restart.
The bootstrap CA comes from that gateway/configured app identity, not a public
proxy to arbitrary managed-instance PKI endpoints.

## Sessions and administrator operations

Use opaque, random session IDs (at least 256 bits), issued only in a cookie such
as `__Host-caddy_ui_session` with `HttpOnly`, `Secure`, `Path=/`, no `Domain`, and
`SameSite=Strict`. Use bounded idle and absolute lifetimes; set matching cookie
expiry and enforce expiry server-side. Proposal: 30-minute idle/12-hour absolute
limits, subject to the final session UX decision.

Login returns public user/session metadata, never the credential. Fetch the
current session from the server to establish UI auth state; cached localStorage
flags cannot grant access. Rotate the session ID on login and sensitive recovery,
revoke on logout/password change/disablement, and support listing/revoking active
sessions. Clear old browser token storage during the cutover.

Validate Origin and a session-bound CSRF token for state-changing browser
requests, including login/bootstrap where applicable. SameSite alone is not the
entire CSRF policy. Keep CSRF tokens in browser memory, and reject missing or
cross-origin mutation requests. Avoid mutations through GET. Restrict CORS to
the intended deployment model; do not combine cookies with blanket credentialed
CORS. Reject insecure requests before processing credentials or setting cookies.

Same-origin downloads and EventSource use the session cookie. Remove query-token
acceptance and bearer-JWT generation from the browser path. Recheck authorization
and expiry on long-lived streams and close them when the user/session is revoked,
including idle streams. Do not log Cookie, Authorization, passwords, setup codes,
CSRF secrets, or session IDs.

All accounts exposed in this release are administrators with full management
authority. Implement account creation/disablement, password changes and session
revocation with backend enforcement. Protect the last enabled administrator in
a transaction; self-service changes must not allow targeting another account.
Provide a local CLI recovery command requiring control of the deployment, with
secure password input and an audit event. No permanent recovery URL/backdoor.

Existing authenticated integrations need an explicit transition. Inventory their
uses before removing JWT support. If machine credentials are required, issue
separate revocable, hashed, scoped API credentials over secure transport; never
repurpose a browser session or retain URL tokens as a compatibility shortcut.
Do not expose a production authentication bypass to make tests pass. Public
metrics remain a specifically documented operator opt-in, not a blanket exception.

## Preparing for multiple users and permissions

Use stable user IDs and separate identity, credential verification, sessions and
authorization services. Resolve a principal on every protected request and read
current account state. Define named capabilities in backend policy rather than
inferring write access from UI controls or HTTP methods.

The first release has only administrator accounts. Do not create member accounts,
expose role dropdowns, or claim instance isolation until the following policy is
implemented and tested. Future schema migrations add instance grants and method-
specific passkey/TOTP credentials without changing user identity.

Proposed policy for discussion with Zack:

| Scope/role | Proposed authority |
| --- | --- |
| Deployment administrator | Accounts, assignments, sessions, instance registration/discovery/admin URLs, shared settings, notification secrets and application audit/log access; all managed instances. |
| Instance operator | Explicitly assigned instances: configuration changes, validations/reloads, routes, operational instance settings and approved certificate operations. No new admin URLs or global identity/settings access. |
| Instance viewer | Explicitly assigned instances: explicitly classified read operations only. Config/log access may reveal secrets, so this requires a deliberate policy, not an automatic grant of every GET endpoint. |
| No assignment | No access to that instance, its status, files, logs or details. |

Before shipping those roles, inventory every API action and classify global versus
instance data. Authorize before resolving/operating on an instance. Unknown IDs
must produce an error, not select another instance; a missing selection can use
only an explicitly authorized default. Filter list/status responses and background
probes triggered by user requests. Enforce the same rules for downloads, history,
CA access, SSE, validation helpers and direct API calls.

Separate per-user display preferences from deployment-wide operational settings;
do not let changing a theme/language imply permission to alter route checks.
Shared configuration and background monitors continue to operate independently
of a human's active session.

A Caddyfile editor controls a whole configuration, and several registry entries
may point at the same Caddy process/storage. A `serverName` or UI route is not a
tenant boundary. Operators are strongly trusted within the managed Caddy security
boundary. Clarify aliases/shared installations before promising per-instance
isolation; this work does not establish mutually distrustful tenant hosting or
resolve the separate admin-URL/SSRF policy discussion.

## Migration and recovery

Treat the legacy environment values as migration input, not a continuing account
database. Offer an explicit local import operation: validate a complete legacy
configuration, hash the password, create an administrator transactionally, and
mark setup completed. Do not print credentials or put them in command arguments.
Do not reopen bootstrap or repeat imports on restart. Tell operators to remove
the original password and obsolete JWT signing secret from their deployment.

Existing tokens stop working at the documented cutover; users sign in again.
Existing auth-disabled deployments must either complete HTTPS setup or explicitly
choose the documented unprotected mode. Preserve instance registrations,
Caddyfiles, history and operational settings. Existing personal settings can seed
the initial administrator's preferences without inventing settings for future
users. Keep authentication initialization distinct from `firstTimeRun`.

Backups must preserve database encryption, be consistent with SQLite/WAL, and
include the encrypted recovery bundle, required independent TLS material and
installation metadata. Keep normal runtime keys and offline recovery codes
separate from those backups. The supported restore operation clears sessions and
bootstrap challenges before
resuming service. Document that copying live database files is unsupported; do
not promise detection of an arbitrary rollback of the entire filesystem. Fail
closed on missing/corrupt state and document local recovery, certificate
loss/rotation, origin changes and schema downgrade
restrictions. App restart preserves users and normal sessions unless explicitly
revoked; recovery/restore deliberately revokes them.

## Intended implementation commits

Each row is one coherent behavior or foundation, with its own meaningful tests
and relevant docs. Adjust boundaries if a row becomes too large; do not split by
filename or combine unrelated account, transport and UI changes to save commits.

| Order and proposed commit | Behavior and likely areas | Review/verification boundary |
| --- | --- | --- |
| 1. `feat(auth): add encrypted identity storage and password verification` | SQLCipher repository layer, normal key provisioning, migrations, Argon2id service and dependency lockfile. No exposed incomplete login flow. | Verified encryption provider, no/wrong-key refusal, encrypted WAL/temp/backup handling, migration constraints, hash/verify/rehash, duplicate users, bounded verification, storage permissions and restart persistence. |
| 2. `fix(auth): reject incomplete configuration and untrusted transport` | Startup policy, lifecycle checks, trusted-proxy/origin handling and narrow public endpoints. | Partial env configuration, broken state, direct HTTP and spoofed forwarding headers fail safely; explicit development mode is tested separately. |
| 3. `feat(setup): add HTTPS gateway and certificate onboarding` | Skip TLS provisioning when trusted HTTPS already exists; otherwise offer opt-in gateway/Compose wiring, persistent TLS identity, local certificate export and temporary read-only setup instructions. | Existing-HTTPS setup reaches the claim form without certificate/gateway steps; public-certificate-only exposure, fingerprint instructions, renewal/restart persistence and loopback/LAN bindings. |
| 4. `feat(setup): claim the initial administrator with a one-time code` | CLI challenge lifecycle, HTTPS claim API and focused setup view; separate owner encryption-recovery code and wrapped key bundle. | Expiry, replay, concurrent claims, HTTP refusal, crash recovery, recovery-code secrecy, locked-database recovery bundle access and closure after setup. |
| 5. `feat(auth): replace browser JWTs with revocable cookie sessions` | Session store/middleware plus the matching login/API/App cutover, cookie-authenticated downloads and streams. | CSRF/origin checks, cookie flags, rotation/revocation/expiry, stale localStorage, URL-token rejection and browser rendering. Backend/frontend changes stay together because this is one protocol change. |
| 6. `feat(accounts): manage administrator accounts and personal preferences` | Administrator/self-service API and corresponding views; preferences separated from global operational settings. | Last-admin races, targeting another user, disabled accounts, session revocation, independent preferences and global-setting boundaries. |
| 7. `feat(auth): add legacy migration and local recovery commands` | Explicit environment import, protected account/database-key recovery, key rotation, restore/revocation behavior and integration transition. | One-shot imports, no secret logging, missing/wrong keys, corrupt state, correct/incorrect recovery codes, encrypted restores, rotation, rejected old tokens and preserved Caddy/instance data. |
| 8. `test(auth): verify onboarding and upgrade flows with real HTTPS` | Remaining full-flow fixtures/browser coverage and CI wiring, plus the final rollout examples/reference consistency check. | Fresh install, migration, local recovery, trusted internal TLS, existing reverse proxy, live streams and direct-HTTP refusal. Keep regressions in their introducing commits; this commit joins the complete scenarios. |

The actual migration/default switch may need to be grouped with session cutover
to avoid an intermediate broken startup. New modules can precede activation;
never deploy half of the protocol change. Update README environment/API/Compose
anchors and detailed docs with each implemented behavior; regenerate Docker Hub
descriptions from their source, never hand-edit them. Update AGENTS.md when its
old auth guidance becomes inaccurate. Add English copy only; human translation
policy remains in effect.

## Verification and decisions before coding

Run the repository's required backend/frontend tests and lint as each relevant
change lands, and render affected views. Use #223's isolated real-Caddy and
Chromium suites for the final flow with trusted test certificates; do not use
`ignoreHTTPSErrors` as proof that HTTPS onboarding works. Verify absence of secrets
in browser storage, URLs, responses and logs. Assert capabilities with direct API
requests as well as disabled UI controls. Existing diagnostics retain semantic
codes, appropriate 401/403 distinctions, request IDs and redacted causes.

Resolve these concrete choices before activating runtime changes:

- Reviewed SQLCipher-compatible/Argon2id packages and the supported Node/image
  matrix, including adapter/crypto licensing and native builds.
- Normal deployment-key provisioning, authenticated recovery-key wrapping,
  encrypted backup/export behavior and the local rotation/recovery procedure.
- Exact optional gateway topology, setup-port binding and fixed-origin/proxy
  configuration for Docker networking, host networking and existing proxies.
- Session idle/absolute lifetimes and the minimal administrator account UI.
- Which currently supported integrations require scoped machine credentials at
  cutover, versus a separately scheduled integration feature.
- Upgrade/versioning strategy for users relying on implicit auth-disabled startup.

Discuss the proposed operator/viewer capability matrix, secret-bearing reads,
shared Caddy installations and invitation/recovery policy with Zack before the
separate permission feature. TOTP, passkeys and external OIDC are follow-ups;
keep interfaces extensible without implementing all three in this branch.
