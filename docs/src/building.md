# Building and custom Nginx

## Building from Source

Native source builds use Node 24. The SQLCipher binding compiles from source on
Linux/macOS; Linux requires Python, make, a C++ compiler and OpenSSL development
headers (`build-essential libssl-dev pkg-config` on Debian/Ubuntu). The Dockerfile
installs its compilation tools temporarily and retains the runtime crypto library.
Windows users can use the Linux container.

```bash
cd backend && docker build -t caddy-ui-backend .
cd frontend && docker build -t caddy-ui-frontend .
```

The backend image copies the Caddy binary from `caddy:latest` at build time for `caddy fmt` formatting and version detection. To pin to a specific Caddy version, edit the first line of the backend Dockerfile before building:

```dockerfile
COPY --from=caddy:v2.11.2 /usr/bin/caddy /usr/bin/caddy
```

If you run Caddy outside of Docker (e.g. systemd), the backend will still work correctly — `caddy fmt` and version detection will degrade gracefully if the binary version doesn't match or is unavailable.

{{#include ../../README.md:custom-nginx}}
