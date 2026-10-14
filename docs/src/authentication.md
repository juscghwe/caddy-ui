# Authentication, upgrade and recovery

{{#include ../../README.md:authentication}}

## First administrator

Use your existing HTTPS reverse proxy if you have one. Set
`CADDY_UI_EXTERNAL_URL` to the exact browser origin, including its port, and trust
only the proxy addresses that actually forward to each service. The frontend
needs `CADDY_UI_TRUSTED_EDGE_IPS`; the backend needs `CADDY_UI_TRUSTED_PROXIES`.
Both must preserve the external Host. An untrusted `X-Forwarded-Proto: https`
header cannot establish HTTPS.

Start the backend, open that HTTPS address and enter its local one-time setup
code. The code expires after ten minutes and ten unsuccessful attempts. Restart
an unclaimed backend or use the local `setup-code` command to replace it.
Creation succeeds once, even if two clients try simultaneously.

Save the database recovery export to your vault/password manager before
continuing to sign-in. It contains the installation ID and a separate random
recovery code, not your password or the raw database key. It is shown only in the
successful setup response and cannot be downloaded later from an API. If the
response is lost, a deployment owner can replace the recovery bundle locally
using `recovery-code`.

A deployment without HTTPS can use the optional
[app-only Caddy gateway](https://github.com/zackwag/caddy-ui/blob/main/deploy/README.md).
Its temporary HTTP listener serves instructions and the **public** app CA only.
Compare the certificate's DER SHA-256 fingerprint with local operator output
before importing it into your OS/browser trust store. Enter setup codes and
passwords only after opening the verified HTTPS address. This CA is distinct from
any CA belonging to a managed Caddy instance.

## Accounts and sessions

All accounts currently have full administrator authority. The Accounts screen
creates/enables/disables administrators, changes your password and revokes your
sessions. Account creation and enablement changes require sign-in within the last
five minutes. The API transaction prevents disabling the last enabled account.
Per-instance roles, invitations, passkeys and TOTP remain follow-ups.

Passwords require at least twelve characters and use salted Argon2id verifiers.
Browser sessions are opaque, random credentials in an HttpOnly/Secure/SameSite
cookie. JavaScript does not receive or store that credential. CSRF tokens are
session-bound and remain in browser memory. Downloads and log streams use the
cookie; bearer JWTs and URL tokens are rejected. Expiry is thirty minutes without
API activity or twelve hours after sign-in. Password changes and disablement
revoke the affected account's sessions. Normal restarts preserve valid sessions;
recovery and restore deliberately revoke them.

Use a dedicated hostname where possible. Cookies belong to a host, not a port;
untrusted HTTPS services on other ports must not share the UI hostname/IP.
Personal language/theme/display settings live in each account's encrypted record.
Operational settings and background monitoring remain deployment-wide.

## Upgrading an existing installation

Back up your instance registry, Caddyfiles/history, operational settings and
independent Caddy/TLS data first. This feature does not migrate or replace those
files. Authentication gets a separate data directory and separately persisted key.

For a complete legacy `CADDY_UI_USER`, `CADDY_UI_PASSWORD`, `JWT_SECRET`
configuration, stop the backend and run `import-legacy` locally with those same
variables and the new auth volume/key paths. The command validates and hashes the
password, preserves one administrator identity, and refuses repeated imports.
Remove all three legacy variables afterward, restart, and enter the new one-time
code over HTTPS to activate the imported account and receive the recovery export.
Sign in using the imported username/password. A password shorter than twelve
characters cannot be imported; replace the legacy input with a strong password
before import or use fresh administrator setup.

An incomplete legacy configuration fails startup; it never disables auth. Existing
JWT sessions stop working, and old browser token storage is cleared. A previously
unprotected installation must establish HTTPS and create its first administrator.
`CADDY_UI_AUTH_MODE=disabled` is an explicit choice only for isolated trusted
development, and the UI displays its unprotected state.

Server integrations cannot reuse browser JWTs after this cutover. Prometheus can
use the explicit public-telemetry setting; it exposes metrics for all registered
instances. The existing unauthenticated Homepage example applies only to isolated
unprotected deployments. Scoped, revocable machine credentials are a follow-up;
there is no public status/configuration exception or broad replacement bearer key.

## Local maintenance commands

Local deployment access is recovery authority: someone who controls the backend
process, runtime encryption key or Docker socket already controls the managed
infrastructure. These commands do not provide a remote authentication bypass.

**Stop the backend before maintenance.** `--offline-confirmed` acknowledges this
operator requirement; it does not detect other processes or containers accessing
the database. Do not run two maintenance commands concurrently. Always use the
same auth paths/volumes as the deployed backend.

Run `node backend/src/auth/cli.js --help` from a source checkout. For Compose,
substitute your actual Compose file and service name:

```sh
docker compose stop caddy-ui-backend
docker compose run --rm --no-deps caddy-ui-backend \
    node src/auth/cli.js setup-code --offline-confirmed
docker compose up -d caddy-ui-backend
```

The optional gateway example needs `-f deploy/bootstrap.compose.yml` on each
Compose command. Native source deployments use Node 24 and the same environment.
Use `node` directly when saving JSON output; npm may add its script banner.

| Command (append `--offline-confirmed`) | Result |
| --- | --- |
| `import-legacy` | Stage the legacy administrator for one-time HTTPS activation |
| `setup-code` | Replace an unclaimed installation's challenge |
| `reset-password USERNAME` | Read a hidden password, enable that existing account, revoke all sessions |
| `recovery-code` | Replace the recovery bundle and print a new recovery export once |
| `recover-key` | Read a recovery export/code and restore a missing runtime key |
| `backup DIRECTORY` | Create a new encrypted, consistent auth backup directory |
| `restore DIRECTORY` | Read its recovery export/code and replace auth state, revoking sessions |
| `rotate-key` | Re-encrypt the database under a new random key and print a new recovery export |
| `complete-transition` | Finish a prepared but interrupted restore or rotation |
| `cancel-transition` | Discard staging only if the active encrypted database is readable |
| `certificate` | Export only the configured app CA and its fingerprint |

Never put passwords/recovery codes in arguments or shell history. Interactive
secret input is hidden. Noninteractive stdin accepts a password/code or the
recovery JSON downloaded during setup. For example, with the server stopped,
feed an export securely from your vault or a protected file:

```sh
docker compose run --rm --no-deps -T caddy-ui-backend \
    node src/auth/cli.js recover-key --offline-confirmed < /protected/recovery-export.json
```

If a runtime key file already exists, `recover-key` refuses to overwrite it.
Inspect and move a damaged key aside locally before trying recovery. A wrong code,
wrong installation or unreadable encrypted database cannot create a replacement
key. Recovery requires all three: encrypted database, matching recovery bundle,
and matching offline code. The code alone cannot recover a lost database.

## Backups, rotation and interrupted operations

`backup` checkpoints encrypted WAL with no other database users and creates a new
private directory containing `auth.sqlite`, `installation.json` and `recovery.json`.
No runtime key or plaintext recovery code is included. Copying live SQLite files
is unsupported. Back up Caddyfiles, instance settings and TLS identity separately;
this command only covers authentication. Keep recovery codes and runtime keys in
separate protected storage. Encryption does not protect against a compromised
running backend, which needs its runtime key to serve requests.

`restore` validates a protected copy before activating it. Restores and key
rotation revoke all sessions and setup challenges. Key rotation creates an
explicitly encrypted SQLCipher export, retains user IDs/preferences, and replaces
the recovery bundle. Save the new code before starting the backend. Earlier
backups need their earlier matching recovery codes; rotation cannot revoke copies
that were already made.

Prepared transitions are stored in a protected directory next to the runtime key.
While that directory exists, startup refuses to guess which database/key to use.
After an interrupted operation, keep the backend stopped and use
`complete-transition` when preparation finished. If preparation failed before a
ready record exists, inspect the local state and use `cancel-transition`; it
refuses cancellation when the active database is unreadable. If completion
succeeded but its recovery-code response was lost, use `recovery-code` to replace
it. Never delete active data/volumes to clear a login failure.

Missing/corrupt files and unsupported schema versions fail closed. Preserve a
verified encrypted backup before upgrades. Downgrading to a build that does not
support the database schema is refused. There is no claim to detect an arbitrary
rollback of every file on the server.

The optional gateway's TLS volume contains its independent CA/private keys. Losing
it requires a new CA and explicitly re-establishing client trust. An HTTPS origin
change requires updating the exact origin/proxy settings; sign in again at the new
origin. Database recovery does not recover TLS keys.
