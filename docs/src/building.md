# Building and custom Nginx

## Building from Source

```bash
docker build -t caddy-ui-backend ./src/backend
docker build -t caddy-ui-frontend ./src/frontend
```

The backend image copies the Caddy binary from `caddy:latest` at build time for `caddy fmt` formatting and version detection. To pin to a specific Caddy version, change the `COPY --from=caddy:latest` line in `src/backend/Dockerfile` before building:

```dockerfile
COPY --from=caddy:v2.11.2 /usr/bin/caddy /usr/bin/caddy
```

If you run Caddy outside of Docker (e.g. systemd), the backend will still work correctly — `caddy fmt` and version detection will degrade gracefully if the binary version doesn't match or is unavailable.

## Published release images

Every successful stable release builds and tags both the backend and frontend
images with the release version, even when only one component's code changed.
Release notes list both image pull commands. The stable version manifest records
only images whose publication succeeded; a failed build can leave a partial
publication and does not establish a complete image pair.

The Release workflow's manual rebuild also produces both images from the selected
tag, using the workflow on `main`. Rebuilding an older single-image release may
therefore add a component tag that was never previously published. The manual
rebuild does not update `latest` or the stable version manifest/release notes.

{{#include ../../README.md:custom-nginx}}
