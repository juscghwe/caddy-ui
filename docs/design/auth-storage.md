# Authentication storage implementation

The identity foundation uses `@journeyapps/sqlcipher` 6.0.0 (BSD-3-Clause),
bundling SQLCipher 4.14.0/SQLite 3.51.3, and `argon2` 0.45.1 (MIT).
The runtime and browser now use this store. The rollout plan remains in
[bootstrap-and-login.md](bootstrap-and-login.md).

The SQLCipher adapter builds from source on Linux/macOS. Native Windows builds
are unsupported by this adapter; Windows deployments can use the Linux container.
Linux builds require Python, make, a C++ compiler, and OpenSSL development headers.
The backend Dockerfile installs those tools only for dependency compilation;
the runtime retains libcrypto. CI installs the equivalent build prerequisites.

The database adapter requires an actual SQLCipher 4 provider and a 32-byte key.
It checks database readability before migrations, uses encrypted WAL with full
synchronization, foreign keys, a bounded busy timeout, memory-only temporary
storage, and private database permissions. Unsupported providers, absent/wrong
keys, and newer schemas fail rather than creating plaintext storage.

The password service encodes salted Argon2id verifiers with 64 MiB memory,
three passes, and one lane. At most two hash/verify operations run concurrently;
extra work receives a rate-limit error. New passwords require 12 characters and
are bounded to 1024 UTF-8 bytes. Login names are case-insensitive, 1–64 ASCII
letters/numbers/dots/underscores/hyphens, starting with a letter or number.

Recovery wrapping uses a separately generated 256-bit code, HKDF-SHA-256 with a
random salt and domain-separated context, and AES-256-GCM with a random 96-bit
nonce. The authenticated metadata binds the format version and installation ID.
Only the encrypted key, tag and non-secret metadata belong in the recovery bundle.
These primitives implement local key wrapping, not a browser transport protocol.

Storage tests exercise persisted ciphertext/WAL, wrong-key refusal, transactions,
schema constraints, authenticated recovery/tampering, private key files and salted
password verification.

The service provisions the runtime key outside the data
directory, an installation marker, explicit configuration/transport validation,
one-time administrator claiming and the wrapped owner recovery bundle. Session
credentials are random 256-bit values stored only as SHA-256 digests; CSRF tokens
use a separately derived HMAC key. Idle/absolute expiry, logout, password changes
and disablement revoke access. Last-admin and concurrent claim protections are
transactional, and privileged mutations recheck the acting session in the same
transaction. Personal preferences have user-owned records. Audit events omit
credentials and are limited to 90 days/10,000 records.

The HTTP router/middleware factory now enforces canonical HTTPS transport,
trusted forwarding, exact browser origin and session-bound CSRF checks. It issues
only HttpOnly/Secure/SameSite cookies, rejects URL/bearer credentials, revokes the
previous cookie session on login, and closes live log streams on revocation or
expiry. Recovery material appears only in the successful uncached claim response.
HTTP API tests exercise those boundaries against a real local Express server.

The runtime/browser cutover now uses these factories. The first administrator
claims over HTTPS, receives a transient owner recovery export, and signs in with
the cookie protocol. Downloads preserve the selected instance without URL tokens.
Client auth state comes from the server, and legacy localStorage credentials are
removed. Explicit unprotected development is visibly marked and remains isolated
in the disposable Caddy harness.

The HTTPS setup/export/login/logout flow has been rendered and exercised in
Chromium with a scoped test-certificate pin. This does not automate an OS CA
installation. Administrator creation/disablement, password changes, session revocation and
per-account preferences now have a browser UI. Local migration/recovery and
full-flow image checks remain required before release.
