// Real backend + browser over a minted test HTTPS origin. No shared user data.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as viteServer } from 'vite';
import { chromium } from 'playwright';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { backendEnvironment } from '../../../scripts/dev-caddy/harness.mjs';
import { authConfig } from '../../../backend/src/auth/config.js';
import { importLegacy } from '../../../backend/src/auth/maintenance.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const execute = promisify(execFile);
const password = 'a sufficiently strong password';
async function unusedPort() {
    const server = createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function stop(child) {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
}
async function waitForBackend(port, child) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('Test backend exited before readiness');
        try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch { /* startup */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Test backend readiness timed out');
}
async function trustCheckedRequest(origin, ca) {
    return new Promise((resolve, reject) => {
        const req = request(origin + '/api/auth/status', { ca }, res => {
            let body = ''; res.setEncoding('utf8'); res.on('data', part => { body += part; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject); req.end();
    });
}
async function fixture(migration, work, instances = []) {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-auth-browser-'));
    let secureVite, plainVite, backend, browser;
    let output = '';
    try {
        const ca = join(directory, 'ca.crt'), caKey = join(directory, 'ca.key');
        const key = join(directory, 'leaf.key'), csr = join(directory, 'leaf.csr'), cert = join(directory, 'leaf.crt');
        await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '1', '-subj', '/CN=Caddy UI test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
        await execute('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=localhost']);
        const extension = join(directory, 'leaf.ext');
        await writeFile(extension, 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n');
        await execute('openssl', ['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '1', '-extfile', extension]);
        const backendPort = await unusedPort();
        const proxy = proto => ({ '/api': { target: `http://127.0.0.1:${backendPort}`, headers: { 'X-Forwarded-Proto': proto } } });
        secureVite = await viteServer({ root: join(root, 'frontend'), cacheDir: join(directory, 'vite-secure'), server: { host: '127.0.0.1', port: 0, https: { key: await readFile(key), cert: await readFile(cert) }, proxy: proxy('https') } });
        await secureVite.listen();
        const origin = secureVite.resolvedUrls.local[0].replace(/\/$/, '');
        plainVite = await viteServer({ root: join(root, 'frontend'), cacheDir: join(directory, 'vite-plain'), server: { host: '127.0.0.1', port: 0, proxy: proxy('http') } });
        await plainVite.listen();
        const plainOrigin = plainVite.resolvedUrls.local[0];
        const env = backendEnvironment(directory, { adminUrl: 'http://127.0.0.1:1', containerName: null, configPath: join(directory, 'Caddyfile'), logPath: join(directory, 'access.log'), dataPath: directory, serverName: 'srv0' });
        Object.assign(env, { CADDY_UI_AUTH_MODE: 'required', CADDY_UI_EXTERNAL_URL: origin, CADDY_UI_AUTH_DATA_PATH: join(directory, 'auth'), CADDY_UI_AUTH_KEY_PATH: join(directory, 'keys', 'database.key'), PORT: String(backendPort) });
        await mkdir(join(directory, 'backend'), { recursive: true });
        await writeFile(env.INSTANCES_PATH, JSON.stringify(instances));
        await writeFile(env.SETTINGS_PATH, JSON.stringify({ firstTimeRun: false, theme: 'dark', language: 'en' }));
        if (migration) await importLegacy(authConfig(env), { CADDY_UI_USER: 'Legacy', CADDY_UI_PASSWORD: password, JWT_SECRET: 'retired-test-signing-key' });
        const start = async () => {
            output = '';
            backend = spawn(process.execPath, ['backend/src/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
            for (const stream of [backend.stdout, backend.stderr]) stream.on('data', bytes => { output += bytes.toString(); });
            await waitForBackend(backendPort, backend);
        };
        await start();
        const code = output.match(/setup code \(10 minutes\): (cui-setup-v1-[A-Za-z0-9_-]+)/)?.[1];
        assert(code, 'Backend did not announce a setup code');
        const trusted = await trustCheckedRequest(origin, await readFile(ca));
        assert.equal(trusted.status, 200); assert.equal(trusted.body.secure, true);
        await assert.rejects(trustCheckedRequest(origin, undefined)); // Untrusted CA must fail.
        // Pin only this minted leaf in Chromium. Node above verifies the actual CA chain.
        // This does not automate installation into a user's OS/browser trust store.
        const spki = createHash('sha256').update(createPublicKey(await readFile(cert)).export({ type: 'spki', format: 'der' })).digest('base64');
        browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--ignore-certificate-errors-spki-list=' + spki] });
        const context = await browser.newContext(); const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        try { await work({ page, context, origin, plainOrigin, code, env, start, stop: () => stop(backend) }); }
        catch (error) { error.message += ' Browser exceptions: ' + JSON.stringify(errors); throw error; }
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); await plainVite?.close(); await secureVite?.close(); await stop(backend);
        await rm(directory, { recursive: true, force: true });
    }
}
async function signIn(page, name, secret = password) {
    await page.locator('#login-user').fill(name); await page.locator('#login-password').fill(secret);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.locator('.shell').waitFor();
}
async function signOut(page) {
    await page.locator('.nav-item').filter({ hasText: 'Sign out' }).click(); await page.locator('#login-user').waitFor();
}
async function saveRecovery(page) {
    await page.getByRole('heading', { name: 'Save your database recovery code' }).waitFor();
    const recovery = await page.getByLabel('Database recovery code', { exact: true }).inputValue();
    assert.match(recovery, /^cui-recovery-v1-/);
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download recovery export' }).click();
    const download = await pending;
    assert.equal(JSON.parse(await readFile(await download.path(), 'utf8')).recoveryCode, recovery);
    assert(!await page.evaluate(code => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(code), recovery));
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Continue to sign in' }).click();
    return recovery;
}

async function browserRequest(page, url, { method = 'GET', headers = {}, data } = {}) {
    const result = await page.evaluate(async request => {
        const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.data, credentials: 'same-origin' });
        return { status: response.status, body: await response.text() };
    }, { url, method, headers, data });
    return { status: () => result.status, text: async () => result.body, json: async () => JSON.parse(result.body) };
}


export { fixture, signIn, signOut, saveRecovery, browserRequest, password };
