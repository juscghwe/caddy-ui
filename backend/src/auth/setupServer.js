import { createServer } from 'node:http';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

export async function setupCertificate(config) {
    if (!config.certificatePath) throw new Error('No app CA configured');
    const pem = await readFile(config.certificatePath);
    if (pem.length > 1024 * 1024) throw new Error('Invalid app CA file');
    const certificate = new X509Certificate(pem);
    if (!certificate.ca) throw new Error('App trust certificate must be a CA');
    // Serialize the certificate itself; never send trailing key material.
    return { pem: certificate.toString(), fingerprint: certificate.fingerprint256 };
}

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export async function startSetupServer(auth, config, { output = text => process.stdout.write(text + '\n') } = {}) {
    if (!auth || !config.setupPort || (await auth.state()).initialized) return null;
    const server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        try {
            if ((await auth.state()).initialized) { res.writeHead(410); res.end(); return; }
            if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
            const path = new URL(req.url, 'http://localhost').pathname;
            if (path === '/certificate.crt') {
                const certificate = await setupCertificate(config);
                res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="caddy-ui-ca.crt"' });
                res.end(req.method === 'HEAD' ? undefined : certificate.pem);
            } else if (path === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(req.method === 'HEAD' ? undefined : `<!doctype html><html lang="en"><meta charset="utf-8"><title>caddy/ui HTTPS setup</title><h1>Secure caddy/ui setup</h1><p>This connection uses HTTP. Passwords and session credentials can be intercepted. Configure HTTPS before signing in or managing Caddy.</p><p>If HTTPS is already configured, open <a href="${escape(config.origin || '#')}">${escape(config.origin || 'the configured HTTPS address')}</a> and enter the setup code there.</p><p>For the optional internal-CA gateway: <a href="/certificate.crt">download the public caddy/ui CA certificate</a>, compare its SHA-256 fingerprint with the operator CLI output, and install certificate trust on your device. Then open the HTTPS address.</p><p>Windows: import into Trusted Root Certification Authorities. macOS: import into Keychain Access and explicitly trust it. Linux: follow your distribution/browser certificate-trust procedure. Only trust the certificate after independently verifying the fingerprint.</p><p>This listener cannot accept credentials or create an account. Never paste the setup or recovery code here.</p></html>`);
            } else { res.writeHead(404); res.end(); }
        } catch { res.writeHead(503); res.end('App CA is not available yet. Check the local gateway configuration.'); }
    });
    let stopped = false;
    let fingerprint = null;
    const announce = async () => {
        if (stopped || !config.certificatePath) return;
        try {
            const certificate = await setupCertificate(config);
            if (certificate.fingerprint !== fingerprint) {
                fingerprint = certificate.fingerprint;
                output('Caddy UI app CA SHA-256 fingerprint (DER): ' + fingerprint);
            }
        } catch { /* The optional gateway can start after the backend. */ }
    };
    const timer = setInterval(announce, 2000);
    timer.unref();
    const close = () => {
        if (stopped) return Promise.resolve();
        stopped = true;
        clearInterval(timer);
        auth.revocations.off('initialized', close);
        return new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    };
    try {
        server.listen(config.setupPort, config.setupHost);
        await once(server, 'listening');
        auth.revocations.once('initialized', close);
        await announce();
        output('Read-only HTTP setup listener: ' + config.setupHost + ':' + config.setupPort);
        return { close, server };
    } catch (error) { await close(); throw error; }
}
