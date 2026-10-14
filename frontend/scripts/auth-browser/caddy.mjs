import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Harness, docker } from '../../../scripts/dev-caddy/harness.mjs';
import { fixture, openPage, signIn, signOut, saveRecovery, browserRequest, password } from './fixture.mjs';

test('real Caddy: cookie-authenticated instance reads, Caddyfile save/download and selected CA', { skip: process.env.CADDY_UI_TEST_DOCKER !== 'true', timeout: 180_000 }, async () => {
    const harness = new Harness(randomBytes(8).toString('hex'));
    try {
        const alpha = await harness.create('alpha');
        const beta = await harness.create('beta');
        const instances = [{ ...alpha.instance, id: 'alpha' }, { ...beta.instance, id: 'beta' }];
        await fixture(false, async ({ page, origin, code }) => {
            await openPage(page, origin);
            try { await page.getByLabel('One-time setup code').waitFor(); }
            catch { throw new Error('Initial setup view was unavailable: ' + (await page.locator('body').innerText()).slice(0,1200)); }
            await page.getByLabel('One-time setup code').fill(code);
            await page.getByLabel('Username', { exact: true }).fill('admin');
            await page.getByLabel('Password', { exact: true }).fill(password);
            await page.getByRole('button', { name: 'Create administrator', exact: true }).click();
            await saveRecovery(page); await signIn(page, 'admin');
            const headers = { 'X-Instance-Id': 'alpha' };
            const status = await browserRequest(page, origin + '/api/status', { headers });
            assert.equal(status.status(), 200); assert.equal((await status.json()).online, true);
            const first = await browserRequest(page, origin + '/api/caddyfile', { headers });
            assert.equal(first.status(), 200); assert.match(await first.text(), /alpha/);
            const second = await browserRequest(page, origin + '/api/caddyfile', { headers: { 'X-Instance-Id': 'beta' } });
            assert.match(await second.text(), /beta/);
            const state = await (await browserRequest(page, origin + '/api/auth/status')).json();
            const next = (await first.text()).replace('Caddy UI test instance: alpha', 'Authenticated integration edit');
            const saved = await browserRequest(page, origin + '/api/caddyfile?fmt=false&sort=false', { method: 'PUT', headers: { ...headers, Origin: origin, 'X-CSRF-Token': state.csrfToken, 'Content-Type': 'text/plain' }, data: next });
            assert.equal(saved.status(), 200, await saved.text());
            assert.equal(await (await fetch(alpha.httpUrl)).text(), 'Authenticated integration edit');
            assert.match(await (await fetch(beta.httpUrl)).text(), /beta/);
            // Initialize the managed Caddy's independent local PKI to exercise its CA download.
            await docker(['exec', harness.resource('alpha'), 'sh', '-c', 'printf "%s" "$1" > /data/dev-caddy/Caddyfile', 'sh', next + '\nlocalhost:443 {\n    tls internal\n    respond "internal TLS test"\n}\n']);
            await docker(['exec', harness.resource('alpha'), 'caddy', 'reload', '--config', alpha.instance.configPath, '--adapter', 'caddyfile']);
            const ca = await browserRequest(page, origin + '/api/tls/ca', { headers });
            assert.equal(ca.status(), 200, await ca.text()); assert.match(await ca.text(), /BEGIN CERTIFICATE/);
            const pendingDownload = page.waitForEvent('download');
            await page.evaluate(async () => {
                const api = await import('/src/utils/api.js');
                api.setInstanceId('alpha');
                return api.downloadText('/caddyfile', 'Caddyfile');
            });
            const download = await pendingDownload;
            assert.match(await readFile(await download.path(), 'utf8'), /Authenticated integration edit/);
            const logs = await browserRequest(page, origin + '/api/logs', { headers });
            assert.equal(logs.status(), 200);
            await page.locator('.instance-dropdown-trigger').click();
            await page.locator('.instance-dropdown-item').filter({ hasText: 'Dev beta' }).click();
            await page.locator('.nav-item').filter({ hasText: 'Logs' }).click();
            await page.locator('.logs-page').waitFor();
            const pendingStream = page.waitForRequest(request => new URL(request.url()).pathname === '/api/logs/stream');
            await page.getByRole('button', { name: /Live/ }).click();
            const streamUrl = new URL((await pendingStream).url());
            assert.equal(streamUrl.searchParams.get('instanceId'), 'beta');
            assert.equal(streamUrl.searchParams.size, 1);
            const requests = setInterval(() => { void fetch(beta.httpUrl + '/auth-stream-beta').catch(() => {}); }, 200);
            try { await page.locator('.log-line').filter({ hasText: '/auth-stream-beta' }).first().waitFor(); }
            finally { clearInterval(requests); }
            await page.getByRole('button', { name: /Stop/ }).click();
            assert.equal((await browserRequest(page, origin + '/api/logs/stream?instanceId=missing')).status(), 404);
            await signOut(page);
            assert.equal((await browserRequest(page, origin + '/api/caddyfile', { headers })).status(), 401);
            assert.equal((await browserRequest(page, origin + '/api/tls/ca', { headers })).status(), 401);
        }, instances);
    } finally { await harness.removeAll({ confirmed: true, purge: true }); }
});
