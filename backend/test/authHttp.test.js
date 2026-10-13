import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import express from 'express';
import { authConfig } from '../src/auth/config.js';
import { openAuth } from '../src/auth/service.js';
import { createAuthMiddleware, createAuthRouter, createAccountsRouter } from '../src/auth/http.js';
import { diagnosticMiddleware } from '../src/errorReporting.js';
import logger from '../src/logger.js';

const password = 'a sufficiently strong password';
const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });

async function fixture({ trusted = true } = {}) {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const root = await mkdtemp(join(tmpdir(), 'caddy-auth-http-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const config = authConfig({ CADDY_UI_AUTH_DATA_PATH: join(root, 'data'), CADDY_UI_AUTH_KEY_PATH: join(root, 'keys', 'key'), CADDY_UI_EXTERNAL_URL: 'https://ui.example.test' });
    const auth = await openAuth(config);
    cleanups.push(() => auth.close());
    const app = express();
    app.set('trust proxy', trusted ? config.proxies : false);
    app.use(express.json({ limit: '4kb' }), diagnosticMiddleware);
    app.use('/api/auth', createAuthRouter(auth, config));
    app.use('/api/accounts', createAccountsRouter(auth, config));
    const guard = createAuthMiddleware(auth, config);
    app.get('/api/protected', guard, (req, res) => res.json({ user: req.user.username }));
    app.get('/api/logs/app/stream', guard, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: {"line":"connected"}\n\n');
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    cleanups.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    config.origin = 'https://127.0.0.1:' + server.address().port;
    const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
        const response = await fetch(origin + path, {
            method, headers: { Origin: config.origin, 'X-Forwarded-Proto': 'https',
                ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
    };
    return { auth, config, origin, request };
}

async function signedIn() {
    const setup = await fixture();
    const code = await setup.auth.setupCode();
    const claim = await setup.request('/api/auth/bootstrap', { method: 'POST', body: { code, username: 'admin', password } });
    expect(claim.status).toBe(201);
    const login = await setup.request('/api/auth/sessions', { method: 'POST', body: { username: 'admin', password } });
    expect(login.status).toBe(200);
    return { ...setup, claim, login, cookie: login.cookie.split(';')[0], csrf: login.data.csrfToken };
}

describe('HTTPS-only cookie authentication API', () => {
    it('allows unprotected development only through explicit disabled configuration', async () => {
        const next = vi.fn();
        await createAuthMiddleware(null, authConfig({ CADDY_UI_AUTH_MODE: 'disabled' }))({}, {}, next);
        expect(next).toHaveBeenCalledOnce();
    });
    it('rejects direct HTTP and spoofed forwarding before claiming or logging in', async () => {
        const { auth, request } = await fixture({ trusted: false });
        const code = await auth.setupCode();
        const denied = await request('/api/auth/bootstrap', { method: 'POST', body: { code, username: 'admin', password } });
        expect(denied.status).toBe(403);
        expect(denied.data.code).toBe('HTTPS_REQUIRED');
        expect(denied.data.recoveryCode).toBeUndefined();
        expect((await auth.state()).initialized).toBe(0);
        const status = await request('/api/auth/status');
        expect(status.data.secure).toBe(false);
        expect(status.data.csrfToken).toBeNull();
    });

    it('delivers recovery only in the successful uncached HTTPS claim response', async () => {
        const { request, claim } = await signedIn();
        expect(claim.headers.get('cache-control')).toBe('no-store');
        expect(claim.data.recoveryCode).toMatch(/^cui-recovery-v1-/);
        const repeated = await request('/api/auth/bootstrap', { method: 'POST', body: { code: 'old', username: 'admin', password } });
        expect(repeated.status).toBe(409);
        expect(repeated.data.recoveryCode).toBeUndefined();
        const status = await request('/api/auth/status');
        expect(status.data.recoveryCode).toBeUndefined();
        expect(status.data.user).toBeNull();
    });

    it('issues only a protected cookie, rejects URL/bearer credentials, and rotates the prior session', async () => {
        const { request, login, cookie } = await signedIn();
        expect(login.cookie).toContain('__Host-caddy_ui_session=');
        for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(login.cookie).toContain(flag);
        expect(login.cookie).not.toContain('Domain=');
        expect(login.data.token).toBeUndefined();
        expect((await request('/api/protected', { headers: { Cookie: cookie } })).status).toBe(200);
        expect((await request('/api/protected?token=legacy', { headers: { Cookie: cookie } })).status).toBe(401);
        expect((await request('/api/protected', { headers: { Cookie: cookie, Authorization: 'Bearer legacy' } })).status).toBe(401);
        const second = await request('/api/auth/sessions', { method: 'POST', body: { username: 'admin', password }, headers: { Cookie: cookie } });
        expect(second.cookie).not.toBe(login.cookie);
        expect((await request('/api/protected', { headers: { Cookie: cookie } })).status).toBe(401);
    });

    it('requires exact origin and CSRF tokens, including Unicode malformed input', async () => {
        const { request, cookie, csrf } = await signedIn();
        const mutate = headers => request('/api/accounts', { method: 'POST', body: { username: 'other', password }, headers: { Cookie: cookie, ...headers } });
        expect((await mutate({ 'X-CSRF-Token': csrf, Origin: 'https://evil.test' })).status).toBe(403);
        expect((await mutate({ Origin: '' })).status).toBe(403);
        expect((await mutate({})).status).toBe(403);
        expect((await mutate({ 'X-CSRF-Token': 'é'.repeat(csrf.length) })).status).toBe(403);
        expect((await mutate({ 'X-CSRF-Token': csrf })).status).toBe(201);
        const roleRequest = await request('/api/accounts', { method: 'POST', body: { username: 'viewer', password, role: 'viewer' }, headers: { Cookie: cookie, 'X-CSRF-Token': csrf } });
        expect(roleRequest.status).toBe(400);
    });

    it('revokes active streams and cookies on logout', async () => {
        const { request, origin, cookie, csrf } = await signedIn();
        const response = await fetch(origin + '/api/logs/app/stream', { headers: { 'X-Forwarded-Proto': 'https', Cookie: cookie } });
        expect(response.status).toBe(200);
        const reader = response.body.getReader();
        await reader.read();
        const logout = await request('/api/auth/sessions/current', { method: 'DELETE', headers: { Cookie: cookie, 'X-CSRF-Token': csrf } });
        expect(logout.status).toBe(200);
        expect(logout.cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
        const ended = await reader.read();
        expect(ended.done).toBe(true);
        expect((await request('/api/protected', { headers: { Cookie: cookie } })).status).toBe(401);
    });
});
