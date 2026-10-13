import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authConfig } from '../src/auth/config.js';
import { openAuth } from '../src/auth/service.js';
import { setupCertificate, startSetupServer } from '../src/auth/setupServer.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const exec = promisify(execFile);

describe('read-only HTTP trust onboarding', () => {
    it('exports only the public CA, prints a verifiable fingerprint, rejects writes and closes after claiming', async () => {
        const root = await mkdtemp(join(tmpdir(), 'caddy-setup-'));
        cleanups.push(() => rm(root, { recursive: true, force: true }));
        const certPath = join(root, 'ca.crt');
        const keyPath = join(root, 'ca.key');
        await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
            '-days', '1', '-subj', '/CN=Caddy UI test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
        // A mistaken combined PEM must never turn the public download into a key export.
        await writeFile(certPath, (await readFile(certPath, 'utf8')) + (await readFile(keyPath, 'utf8')));
        const reservation = createServer().listen(0, '127.0.0.1');
        await once(reservation, 'listening');
        const port = reservation.address().port;
        await new Promise(resolve => reservation.close(resolve));
        const config = authConfig({ CADDY_UI_AUTH_DATA_PATH: join(root, 'auth'), CADDY_UI_AUTH_KEY_PATH: join(root, 'keys', 'database.key'),
            CADDY_UI_EXTERNAL_URL: 'https://ui.example.test', CADDY_UI_SETUP_PORT: String(port), CADDY_UI_SETUP_CA_PATH: certPath });
        const auth = await openAuth(config);
        cleanups.push(() => auth.close());
        const output = [];
        const listener = await startSetupServer(auth, config, { output: text => output.push(text) });
        cleanups.push(() => listener.close());
        const origin = 'http://127.0.0.1:' + port;
        const page = await fetch(origin);
        expect(page.headers.get('cache-control')).toBe('no-store');
        expect(await page.text()).toContain('This connection uses HTTP');
        const certificate = await (await fetch(origin + '/certificate.crt')).text();
        expect(certificate).toContain('BEGIN CERTIFICATE');
        expect(certificate).not.toContain('PRIVATE KEY');
        const { fingerprint } = await setupCertificate(config);
        const external = await exec('openssl', ['x509', '-in', certPath, '-noout', '-fingerprint', '-sha256']);
        expect(external.stdout.trim().split('=')[1]).toBe(fingerprint);
        expect(output.join('\n')).toContain(fingerprint);
        expect((await fetch(origin + '/certificate.crt', { method: 'POST', body: 'secret' })).status).toBe(405);
        expect((await fetch(origin + '/api/auth/bootstrap')).status).toBe(404);
        const closed = once(listener.server, 'close');
        await auth.claim({ code: await auth.setupCode(), username: 'admin', password: 'a sufficiently strong password' });
        await closed;
        await expect(fetch(origin)).rejects.toThrow();
        expect(await startSetupServer(auth, config)).toBeNull();
    });
});
