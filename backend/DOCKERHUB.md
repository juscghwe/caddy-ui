<!-- AUTO-GENERATED using .github/scripts/dockerhub-docs.mjs from README.md for release 2.21.2. Do not edit directly. -->

# caddy/ui — Backend

The API backend for [caddy/ui](https://hub.docker.com/r/zackwag/caddy-ui-frontend), a web interface for managing your [Caddy](https://caddyserver.com) server. Built with Node.js and Express.

> This is the **backend** image. You will also need the [frontend image](https://hub.docker.com/r/zackwag/caddy-ui-frontend).

## Overview

caddy/ui is a self-hosted management interface for Caddy. It runs as two Docker containers alongside your Caddy instance(s) and communicates with Caddy's built-in admin API. Your Caddyfile remains the source of truth — the UI reads from it, writes to it, and never takes ownership away from you. Manage one Caddy server or many from a single interface.

## Features

- Proxies requests to Caddy's admin API (`/config`, `/id`, `/load`)
- Reads and writes the Caddyfile on disk
- Runs `caddy validate` via Caddy's `/adapt` admin API endpoint
- Runs `caddy fmt` and detects Caddy version via `docker exec` into the running Caddy container (requires Docker socket mount)
- Sorts Caddyfile site blocks on save (public → internal → http)
- Appends, updates, and removes site blocks when routes are managed via the UI
- Fetches routes from all HTTP servers with recursive upstream extraction for complex route structures
- Health checks use Caddy's reverse proxy upstream pool API as primary source, with TCP fallback for upstreams not yet in the pool
- Persisted per-upstream uptime history with a configurable retention window (default 7 days)
- Push notifications via ntfy, Discord, Slack, Pushover, or custom webhook — triggered on upstream offline/online and cert expiry
- Configurable notification debounce to suppress repeat alerts
- Reads TLS certificate files from disk and parses expiry dates
- Detects and deletes orphaned, superseded, and expired certificates (resolves issuer directory automatically)
- Root CA cert download via Caddy's `/pki/ca/local` admin API
- Automatic Caddyfile snapshots on every save with configurable retention
- Tails and streams access logs via SSE
- Parses and updates log configuration in the global Caddyfile block
- Persists server labels and route notes to disk
- Required-by-default account authentication for management APIs
- Caddy process info and HTTP metrics via Prometheus endpoint
- Metrics enable/disable toggle that modifies the Caddyfile global block
- Optional public `/api/metrics/raw` endpoint for Prometheus scraping
- Structured JSON logging with configurable log level via `LOG_LEVEL`
- Enriched status endpoint with route count, upstream health, and uptime for Homepage widget support

## Quick Start

### Prerequisites

- Docker and Docker Compose
- An existing Caddy container with the admin API enabled on `0.0.0.0:2019`

### 1. Enable Caddy's admin API

Add the following to your Caddyfile global block:

```caddyfile
{
    admin 0.0.0.0:2019
    email {$EMAIL}
}
```

> Note: the `CADDY_ADMIN` environment variable does not configure this — it must be set in the Caddyfile.

### 2. Create required directories

```bash
mkdir -p /docker/caddy/logs
mkdir -p /docker/caddy-ui
mkdir -p /docker/caddy-ui-keys
```

### 3. Configure HTTPS for caddy/ui

If the UI is already behind HTTPS, keep that proxy and configure the external
origin and trusted proxy identities below. Otherwise, add a route to your Caddyfile
for a hostname you control (replace `caddy-ui.example.com` and configure its DNS):

```caddy
caddy-ui.example.com {
    reverse_proxy caddy-ui-frontend:80
}
```

For private installations without a public domain, the optional
[app-only gateway](deploy/README.md) provides internal-CA HTTPS with guided trust
installation. Authentication requires HTTPS; no JWT signing secret is needed.

### 4. Update your compose file

```yaml
services:
  caddy:
    image: caddy:latest
    container_name: caddy
    restart: unless-stopped
    ports:
      - 80:80
      - 443:443
    environment:
      - CADDY_LOG_PATH=/var/log/caddy/access.log
      - DOMAIN=example.com
      - EMAIL=you@example.com
      - TZ=America/New_York
    volumes:
      - /docker/caddy/Caddyfile:/etc/caddy/Caddyfile
      - /docker/caddy/data:/data
      - /docker/caddy/config:/config
      - /docker/caddy/logs:/var/log/caddy
    networks:
      caddy-ui:
        ipv4_address: 172.30.99.2

  caddy-ui-backend:
    image: zackwag/caddy-ui-backend:latest
    container_name: caddy-ui-backend
    restart: unless-stopped
    environment:
      - TZ=America/New_York
      # Optional -- enable installed additional UI languages (English is always available)
      - CADDY_UI_ADDITIONAL_LANGUAGES=de
      - CADDY_ADMIN_URL=http://caddy:2019
      - CADDY_UI_EXTERNAL_URL=https://caddy-ui.example.com
      - CADDY_UI_TRUSTED_PROXIES=172.30.99.3/32
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /docker/caddy-ui:/etc/caddy-ui
      - /docker/caddy-ui-keys:/etc/caddy-ui-keys
    networks:
      caddy-ui:
        ipv4_address: 172.30.99.4
    depends_on:
      - caddy

  caddy-ui-frontend:
    image: zackwag/caddy-ui-frontend:latest
    container_name: caddy-ui-frontend
    restart: unless-stopped
    ports:
      - 9877:80
    environment:
      - CADDY_UI_TRUSTED_EDGE_IPS=172.30.99.2/32
    networks:
      caddy-ui:
        ipv4_address: 172.30.99.3
    depends_on:
      - caddy-ui-backend

networks:
  caddy-ui:
    driver: bridge
    ipam:
      config:
        - subnet: 172.30.99.0/24
```

The backend uses the **Docker socket**, its **persistent data directory**, and a
separate **database-key directory**. Preserve the latter across recreation and
protect it separately from database backups. No managed Caddy volume mounts are
required. If the example's subnet conflicts with your network, choose an unused
private subnet and update the three addresses and trusted-proxy settings together.

### 5. Deploy

```bash
docker compose up -d
```

Read the one-time setup code from `docker compose logs caddy-ui-backend`, then open
the configured HTTPS origin to create the first administrator. Save the separately
issued recovery export in your vault/password manager. The HTTP frontend address
provides guidance and cannot authenticate users.

## Architecture
caddy/ui runs as two services: a React frontend served by Nginx and a Node.js/Express backend. The frontend proxies API requests to the backend, which communicates with Caddy's admin API.

In Docker mode, the backend uses the Docker socket for container discovery and file operations inside Caddy containers. Its persistent configuration directory stores application settings and instance data. Local mode supports Caddy installations outside Docker. The Caddyfile remains the source of truth.

## Environment Variables

All backend variables have sensible defaults. Only set what you need to override.

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_VERSION` | `dev` | caddy-ui's own version, exposed at `GET /api/version` and shown in the sidebar. Baked in automatically by the release build (`docker build --build-arg APP_VERSION=...`) — no need to set by hand unless building from source and want the UI to report a specific version. |
| `CADDY_ADMIN_URL` | — | URL of Caddy's admin API. If set, a default instance is auto-created on first startup. If unset, caddy/ui starts with no instances and guides you through discovery. |
| `CADDYFILE_TITLES` | auto | Store route titles as `#` comments in the Caddyfile (see [Caddyfile Titles](https://zackwag.github.io/caddy-ui/caddyfile.html#caddyfile-titles)) |
| `CADDY_CONFIG_PATH` | `/etc/caddy/Caddyfile` | Path to the Caddyfile inside the Caddy container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_CONTAINER_NAME` | `caddy` | Name of the Caddy Docker container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_DATA_PATH` | `/data/caddy` | Path to Caddy's data directory inside the container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_LOG_PATH` | `/var/log/caddy/access.log` | Path to Caddy's access log inside the container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_SERVER_NAME` | `srv0` | Server ID of the Caddy HTTP server new routes are added to, usually `srv0` (only used with `CADDY_ADMIN_URL`). Server IDs come from Caddy; set your own with the `name` option of the Caddyfile's global `servers` block |
| `CADDY_UI_ADDITIONAL_LANGUAGES` | — | Comma-separated additional UI language codes to enable (for example `de,fr`). English is always enabled; only languages with an installed frontend locale catalog are shown. |
| `CADDY_UI_AUTH_MODE` | `required` | Require stored administrator accounts; `disabled` explicitly selects unprotected access for isolated trusted development |
| `CADDY_UI_AUTH_DATA_PATH` | `/etc/caddy-ui/auth` | Encrypted account/session database and encrypted recovery bundle directory |
| `CADDY_UI_AUTH_KEY_PATH` | `/etc/caddy-ui-keys/database.key` | Private 32-byte runtime key file, outside the auth data directory; generated only for a fresh installation |
| `CADDY_UI_EXTERNAL_URL` | — | Canonical HTTPS origin, including a non-default port if used |
| `CADDY_UI_TRUSTED_PROXIES` | `loopback` | Backend's comma-separated trusted proxy IPs/CIDRs; forwarding from other peers cannot establish HTTPS |
| `CADDY_UI_TRUSTED_EDGE_IPS` | — | Frontend's comma-separated trusted HTTPS edge IPs/CIDRs; incoming HTTPS forwarding is discarded unless its peer is listed |
| `CADDY_UI_SETUP_PORT` | `0` | Optional temporary read-only HTTP instruction/CA listener; disabled at zero and closed after administrator claiming |
| `CADDY_UI_SETUP_HOST` | `127.0.0.1` | Bind address for the optional setup listener; LAN/container exposure requires an explicit override |
| `CADDY_UI_SETUP_CA_PATH` | — | Fixed path to the app gateway's public CA certificate for setup download/fingerprint output |
| `CADDY_UI_PASSWORD` | — | Deprecated legacy migration input; not a continuing account/password store |
| `CADDY_UI_PUBLIC_METRICS` | `false` | Expose `/api/metrics/raw` without auth |
| `CADDY_UI_UPDATE_CHECK` | `true` | Check hourly for newer caddy-ui images and show an "Update available" badge in the sidebar (plus a notification for new releases, if notifications are on). Reads a small `versions.json` from GitHub (`raw.githubusercontent.com`); set to `false` to disable |
| `CADDY_UI_UPDATE_CHECK_URL` | `https://raw.githubusercontent.com/zackwag/caddy-ui/versions/versions.json` | Where the update check reads published image versions from |
| `CADDY_UI_USER` | — | Deprecated legacy migration username; missing values never disable auth |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Path to the Docker socket for container discovery and `docker exec` operations |
| `HISTORY_PATH` | `/etc/caddy-ui/history` | Path to the Caddyfile snapshot directory |
| `INSTANCES_PATH` | `/etc/caddy-ui/instances.json` | Path to the multi-instance configuration file (see [Multi-Instance](https://zackwag.github.io/caddy-ui/instances.html#multi-instance)) |
| `JWT_SECRET` | — | Deprecated legacy migration input; browser sessions no longer use JWTs |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `MAINTENANCE_PATH` | `/etc/caddy-ui/maintenance.json` | Path to the maintenance mode state file |
| `NOTIFICATIONS_CONFIG_PATH` | `/etc/caddy-ui/notifications.json` | Path to the notification settings file |
| `PORT` | `3001` | Port the backend listens on |
| `ROUTE_NOTES_PATH` | `/etc/caddy-ui/route-notes.json` | Path to the route notes file |
| `SERVER_NAMES_PATH` | `/etc/caddy-ui/server-names.json` | Path to the per-instance server labels file |
| `SETTINGS_PATH` | `/etc/caddy-ui/settings.json` | Shared operational settings and legacy initial-administrator preference seed; authenticated display preferences are stored per user in encrypted storage |
| `THEMES_PATH` | `/etc/caddy-ui/themes` | Path to the custom themes directory (see [Custom Themes](https://zackwag.github.io/caddy-ui/themes.html#custom-themes)) |
| `UPTIME_HISTORY_PATH` | `/etc/caddy-ui/uptime-history.json` | Path to the persisted upstream and route uptime history file |
| `UPTIME_HISTORY_RETENTION_DAYS` | `7` | How many days of upstream and route health checks to retain |
| `WWW_PATH` | `/etc/caddy-ui/www` | Directory for the maintenance page HTML file (created on first use) |
| `NODE_EXTRA_CA_CERTS` | — | Path to a PEM bundle of extra CAs for route checks to trust, for sites with certificates from a private CA other than Caddy's local one (standard Node.js variable) |

## Authentication

Authentication is required by default. Configure `CADDY_UI_EXTERNAL_URL` and the
trusted proxy hops, establish HTTPS, and exchange the one-time code printed by
the local backend to create the first administrator. Existing HTTPS deployments
go directly to this form; no certificate download or additional gateway is needed.

Passwords use salted Argon2id verifiers in an encrypted SQLCipher database.
Browser sessions use revocable HttpOnly/Secure/SameSite cookies; no session token
is returned in JSON, kept in localStorage, or accepted in URLs. Mutations require
the configured Origin and session-bound `X-CSRF-Token`. Sessions expire after
30 minutes without API activity or 12 hours absolutely; logout, password changes
and account disablement revoke access, including live log streams.

The owner receives a database recovery code once over the established HTTPS
connection, with a download for their vault/password manager. Keep this code
separate from backups; recovery also needs the encrypted bundle and database.
The existing TLS tab manages the selected Caddy instance's CA, which may differ
from the certificate used to trust the UI itself.

`GET /api/auth/status`, `GET /api/version`, and `GET /api/languages` remain public.
With `CADDY_UI_PUBLIC_METRICS=true`, GET `/api/metrics` and `/api/metrics/raw` are
explicitly public telemetry; other routes remain protected. Legacy bearer/query
JWTs stop working at this cutover. Incomplete/conflicting auth configuration and
missing/corrupt encrypted state fail rather than falling back to unprotected
access. `CADDY_UI_AUTH_MODE=disabled` is an explicit, visibly marked choice for
isolated trusted development.

The Accounts screen manages administrators, password changes and session
revocation. Personal themes/language/display preferences belong to each user;
operational checks remain deployment settings. Administrator creation/enablement
changes require a session established within the last five minutes. The last
enabled administrator cannot be disabled.

Local deployment-owner commands provide explicit legacy import, password/key
recovery, encrypted backup/restore and key rotation. Stop the backend before
using them; see the [authentication and upgrade guide](https://zackwag.github.io/caddy-ui/authentication.html).
All accounts in this version are administrators. Per-instance permissions,
scoped machine credentials, passkeys and TOTP are separate follow-ups.

## Prometheus Metrics

Enable Caddy's metrics endpoint from the Metrics tab, or add `metrics` to your Caddyfile global block manually. Set `CADDY_UI_PUBLIC_METRICS=true` to expose `/api/metrics/raw` without auth for Prometheus scraping.

```yaml
scrape_configs:
  - job_name: caddy
    static_configs:
      - targets: ['caddy-ui-backend:3001']
    metrics_path: /api/metrics/raw
```

Alongside Caddy's own metrics, the endpoint serves caddy-ui's upstream uptime history for **every** instance (labeled `instance_id`, `instance_name`, `upstream`), plus route check history when route checks are on (labeled `instance_id`, `instance_name`, `route`), even when Caddy's metrics are disabled:

| Metric | Description |
|---|---|
| `caddy_ui_upstream_up` | Result of the most recent check (1 = online, 0 = offline) |
| `caddy_ui_upstream_uptime_ratio` | Fraction of retained checks that were online (see `UPTIME_HISTORY_RETENTION_DAYS`) |
| `caddy_ui_upstream_state_duration_seconds` | Time the upstream has been in its current state |
| `caddy_ui_route_up` | Result of the most recent route check (1 = online, 0 = offline) |
| `caddy_ui_route_uptime_ratio` | Fraction of retained route checks that were online |
| `caddy_ui_route_state_duration_seconds` | Time the route has been in its current state |
| `caddy_ui_caddy_metrics_up` | Whether Caddy's `/metrics` could be scraped for the requested instance |

Upstreams that haven't been checked in 5 minutes, and routes that haven't been checked in 12.5 minutes (2.5 route check intervals), are omitted: they've been removed from the config, skipped, or their instance is unreachable.

## Homepage Widget

The status endpoint returns enriched data for use with [Homepage](https://gethomepage.dev).
The unauthenticated example below requires an isolated deployment with explicitly
disabled authentication. Required mode needs a browser session; scoped machine
credentials are a follow-up. Do not expose status publicly or disable auth on a
network-facing deployment to make this widget work:

```yaml
- Caddy:
    href: https://caddy.home
    icon: caddy.png
    widget:
        type: customapi
        url: http://caddy-ui-backend:3001/api/status
        mappings:
            - field: online
              label: Status
              format: text
              remap:
                  - value: true
                    to: Online
                  - value: false
                    to: Offline
            - field: routeCount
              label: Routes
              format: number
            - field: upstreamsOnline
              label: Upstreams
              format: number
            - field: uptime
              label: Uptime
              format: text
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/bootstrap` | Claim the initial administrator with the local one-time code, over HTTPS only |
| `POST` | `/api/auth/sessions` | Authenticate and receive a protected session cookie and CSRF metadata |
| `GET` | `/api/auth/status` | Read setup/transport status and current public session metadata |
| `GET` | `/api/auth/sessions` | List the current user's active sessions |
| `DELETE` | `/api/auth/sessions/current` | Revoke the current session and clear its cookie |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one of the current user's sessions |
| `PUT` | `/api/auth/password` | Change the current password and revoke all of that user's sessions |
| `GET` | `/api/accounts` | List administrator accounts |
| `POST` | `/api/accounts` | Create another administrator; requires a recently established session |
| `PATCH` | `/api/accounts/:id` | Enable/disable an administrator, protecting the last enabled administrator |
| `GET` | `/api/metrics` | Parsed HTTP metrics for the Metrics tab |
| `GET` | `/api/metrics/config` | Check if Caddy metrics directive is enabled |
| `PUT` | `/api/metrics/config` | Enable or disable Caddy metrics directive |
| `GET` | `/api/metrics/raw` | Raw Prometheus metrics (public if `CADDY_UI_PUBLIC_METRICS=true`) |
| `GET` | `/api/status` | Server status, route count, upstream health, and uptime |
| `GET` | `/api/status/caddy-config` | Full raw Caddy JSON config |
| `GET` | `/api/status/process` | Caddy process info including version |
| `GET` | `/api/caddyfile` | Read Caddyfile from disk |
| `GET` | `/api/caddyfile?download=true` | Download Caddyfile as a timestamped attachment |
| `PUT` | `/api/caddyfile` | Save, validate, format, and reload |
| `POST` | `/api/caddyfile/validations` | Validate (and optionally format) without saving |
| `POST` | `/api/caddyfile/reloads` | Reload Caddy from disk |
| `GET` | `/api/caddyfile/history` | List all Caddyfile snapshots |
| `GET` | `/api/caddyfile/history/:filename` | Read a specific snapshot |
| `DELETE` | `/api/caddyfile/history/:filename` | Delete a snapshot |
| `GET` | `/api/routes` | List all routes across all HTTP servers |
| `POST` | `/api/routes` | Add a reverse proxy route |
| `PATCH` | `/api/routes/:id` | Update a UI-managed route by ID |
| `DELETE` | `/api/routes/:id` | Remove a route and its Caddyfile block |
| `GET` | `/api/route-notes` | Read all route notes |
| `PUT` | `/api/route-notes/:domain` | Set or clear a route note |
| `GET` | `/api/health` | Check upstream health via Caddy pool API with TCP fallback |
| `GET` | `/api/health/uptime` | Uptime stats per upstream from persisted history |
| `GET` | `/api/health/history` | Raw timestamped checks for one upstream, for the route status history view |
| `GET` | `/api/tls` | List all certificates with expiry and status |
| `DELETE` | `/api/tls/:domain` | Delete an orphaned, superseded, or expired internal cert |
| `GET` | `/api/tls/ca` | Download Caddy's root CA certificate |
| `GET` | `/api/logs` | Last 200 lines of the access log |
| `GET` | `/api/logs/stream` | SSE stream of live log output |
| `GET` | `/api/logs/config` | Read log configuration |
| `PUT` | `/api/logs/config` | Update log configuration |
| `GET` | `/api/server-names` | Read server labels for the selected instance |
| `GET` | `/api/server-names/all` | Read server labels for every instance |
| `PUT` | `/api/server-names/:id` | Set a server label |
| `DELETE` | `/api/server-names/:id` | Remove a server label |
| `GET` | `/api/notifications/config` | Read notification settings |
| `PUT` | `/api/notifications/config` | Update notification settings |
| `POST` | `/api/notifications/test` | Send a test notification |

## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release |
| `beta` | Pre-release build of a specific branch or pull request, published manually for testing |
| `edge` | Most recent build of any kind: every push to `main` and every `beta` build. May contain unreleased or unmerged changes |

See [GitHub releases](https://github.com/zackwag/caddy-ui/releases)
for versioned image tags and release notes.

## Full Documentation

See the [GitHub README](https://github.com/zackwag/caddy-ui#readme) for complete setup, features, configuration, and API documentation.
