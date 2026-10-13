# Optional caddy/ui HTTPS gateway

This example is work in progress on `feat/bootstrap-and-login`. Use it after the
runtime/browser cutover checkpoint. It provisions HTTPS for the UI itself without
changing any Caddy installation you manage.

If the UI is already behind HTTPS, keep that proxy. Configure the canonical
`CADDY_UI_EXTERNAL_URL`, the backend's `CADDY_UI_TRUSTED_PROXIES`, and the frontend's
`CADDY_UI_TRUSTED_EDGE_IPS` for the actual proxy hops. The latter accepts explicit
comma-separated IPs/CIDRs and is empty by default. The frontend preserves HTTPS
forwarding only from those peers, and strips untrusted forwarding headers.
Requests must preserve the external Host, including a non-default port.
Proceed directly to the one-time code/administrator form over HTTPS.

For a deployment without HTTPS, set the hostname/IP that the browser will use:

```sh
export CADDY_UI_HOST=192.168.1.10
docker compose -f deploy/bootstrap.compose.yml up --build -d
docker compose -f deploy/bootstrap.compose.yml logs caddy-ui-backend
```

The web origin is `https://192.168.1.10:9877` by default. Change
`CADDY_UI_HTTPS_PORT` if needed. Hostnames require working local DNS/hosts entries.
Do not use a container name that your browser cannot resolve.

The optional read-only HTTP instruction/CA listener is published on
`127.0.0.1:9878`. Reach it locally or through an SSH forward. If LAN access is
required, explicitly set `CADDY_UI_SETUP_BIND` to the host's LAN IP before starting
Compose. It cannot receive login/setup credentials and closes after administrator
creation. The backend's management port is not published.

Download the public `certificate.crt` from that listener and compare its SHA-256
fingerprint with the backend's operator output before installing trust:

```sh
openssl x509 -in certificate.crt -noout -fingerprint -sha256
```

Use your OS/browser's CA import procedure. Windows uses Trusted Root Certification
Authorities; macOS uses Keychain Access with explicit certificate trust. Linux
trust stores depend on the distribution/browser. A CA grants trust to certificates
it signs, so verify the fingerprint independently and keep its private material
protected. No page can silently install this trust for you.

Open the verified HTTPS origin, enter the code printed by the local backend, and
create the initial administrator. Codes expire after ten minutes. Save the
separate database recovery code in your vault/password manager when offered.

The `caddy-ui-state`, `caddy-ui-keys`, and `caddy-ui-tls` volumes have separate
roles. Preserve them across container recreation. Back up state with its encrypted
recovery bundle; protect normal keys and offline recovery codes separately. Do
not remove volumes to troubleshoot login or run `down -v` unless intentionally
destroying the installation.

The example reserves `172.30.99.0/24` for proxy identities. Set
`CADDY_UI_NETWORK_PREFIX` to an unused private /24 prefix if it conflicts with your
networks. Both the gateway's source identity and the backend's trusted frontend
identity follow that prefix. The backend has Docker-socket access and can read the
gateway's TLS volume; it remains a highly trusted infrastructure service.

For builds behind a certificate-injecting proxy, the backend Dockerfile accepts
an optional BuildKit secret named `proxy_ca`. Mount the trusted CA for the install
steps; it is not copied into the resulting image. Ordinary builds need no secret.
