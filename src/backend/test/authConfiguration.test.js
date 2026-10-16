import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET'];
// Runtime-only fixtures: no checked-in credentials or signed tokens.
const values = Object.fromEntries(KEYS.map(key => [key, randomBytes(24).toString('hex')]));
const execute = promisify(execFile);

async function loadAuth(env = {}) {
    vi.resetModules();
    for (const key of KEYS) vi.stubEnv(key, env[key]);
    vi.stubEnv('CADDY_UI_PUBLIC_METRICS', undefined);
    return import('../src/middleware/auth.js');
}

afterEach(() => vi.unstubAllEnvs());

describe('auth configuration', () => {
    it.each([
        ['none', []],
        ['username', [KEYS[0]]],
        ['password', [KEYS[1]]],
        ['signing key', [KEYS[2]]],
        ['username and password', KEYS.slice(0, 2)],
        ['username and signing key', [KEYS[0], KEYS[2]]],
        ['password and signing key', KEYS.slice(1)],
        ['all', KEYS],
    ])('validates the presence combination: %s', async (_label, present) => {
        const env = Object.fromEntries(present.map(key => [key, values[key]]));
        if (present.length === 0 || present.length === KEYS.length) {
            expect((await loadAuth(env)).authEnabled).toBe(present.length > 0);
        } else {
            const error = await loadAuth(env).catch(error => error);
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('Refusing to start');
            expect(error.message).toContain(`Provided variable names: ${present.join(', ')}.`);
            expect(error.message).toContain(`Missing, empty or whitespace-only: ${KEYS.filter(key => !present.includes(key)).join(', ')}.`);
            for (const value of Object.values(env)) expect(error.message).not.toContain(value);
        }
    });

    it.each(KEYS)('rejects an empty or whitespace-only %s', async key => {
        for (const invalid of ['', ' ', '\t\n']) {
            await expect(loadAuth({ ...values, [key]: invalid })).rejects.toThrow(key);
        }
    });

    it.each(['', ' ', '\t\n'])('rejects all three explicitly blank settings (%j)', async blank => {
        await expect(loadAuth(Object.fromEntries(KEYS.map(key => [key, blank])))).rejects.toThrow('Refusing to start');
    });

    it.each(KEYS)('does not treat an explicitly empty %s as an absent setting', async key => {
        await expect(loadAuth({ [key]: '' })).rejects.toThrow('Refusing to start');
    });
});

it.each([false, true])('preserves API authentication behavior (enabled=%s)', async enabled => {
    const env = enabled ? Object.fromEntries(KEYS.map(key => [key, ` ${values[key]} `])) : {};
    const { authEnabled, authMiddleware } = await loadAuth(env);
    const { default: authRouter } = await import('../src/routes/auth.js');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.get('/api/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        expect(authEnabled).toBe(enabled);
        expect((await fetch(url + '/api/protected')).status).toBe(enabled ? 401 : 200);
        expect((await (await fetch(url + '/api/auth/status')).json()).authEnabled).toBe(enabled);
        if (enabled) {
            const response = await fetch(url + '/api/auth/sessions', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: env.CADDY_UI_USER, password: env.CADDY_UI_PASSWORD }),
            });
            expect(response.status).toBe(200);
            const { token } = await response.json();
            expect(jwt.verify(token, env.JWT_SECRET).username).toBe(env.CADDY_UI_USER);
            expect((await fetch(url + '/api/protected', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
        }
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

it('rejects partial configuration in the actual backend before any listener is attempted', { timeout: 15000 }, async () => {
    const env = { ...process.env, CADDY_UI_USER: values.CADDY_UI_USER, CADDY_UI_PASSWORD: values.CADDY_UI_PASSWORD,
        CADDY_UI_UPDATE_CHECK: 'false', PORT: '0' };
    delete env.JWT_SECRET;
    // Fail loudly on any attempted listener, without ever exposing a test API.
    const guard = Buffer.from("import { Server } from 'node:net'; Server.prototype.listen = () => { console.error('AUTH_TEST_LISTEN_ATTEMPT'); process.exit(99); };").toString('base64');
    const result = await execute(process.execPath, [
        '--import', `data:text/javascript;base64,${guard}`, fileURLToPath(new URL('../src/index.js', import.meta.url)),
    ], { env, timeout: 10000, maxBuffer: 64 * 1024 }).catch(error => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Refusing to start');
    expect(result.stderr).toContain('JWT_SECRET');
    expect(result.stderr).not.toContain('AUTH_TEST_LISTEN_ATTEMPT');
    for (const value of Object.values(values)) expect(result.stderr + result.stdout).not.toContain(value);
});
