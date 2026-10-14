import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let api;
let storage;
beforeEach(async () => {
    vi.resetModules();
    storage = new Map([['caddy_ui_token', 'legacy-bearer'], ['caddy_ui_auth_enabled', 'true'], ['caddy_ui_instance', 'chosen']]);
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key), removeItem: key => storage.delete(key), setItem: (key, value) => storage.set(key, value) });
    api = await import('../src/utils/api.js');
});
afterEach(() => vi.unstubAllGlobals());

describe('browser session protocol', () => {
    it('clears legacy credentials and establishes auth only from server state', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ authEnabled: true, initialized: true, secure: true, user: null })));
        const state = await api.fetchAuthState();
        expect(state.user).toBeNull();
        expect(storage.has('caddy_ui_token')).toBe(false);
        expect(storage.has('caddy_ui_auth_enabled')).toBe(false);
        expect(storage.get('caddy_ui_instance')).toBe('chosen');
        fetch.mockResolvedValue(response({}));
        await expect(api.fetchAuthState()).rejects.toMatchObject({ code: 'CLIENT_PARSE_FAILED' });
    });
    it('sends cookie credentials and CSRF without storing a bearer token', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ csrfToken: 'session-csrf', user: { id: 'user' } })));
        await api.apiFetch('/auth/sessions', { method: 'POST', body: '{}' });
        fetch.mockResolvedValue(response({ ok: true }));
        await api.apiFetch('/settings', { method: 'PUT', body: '{}' });
        const [, options] = fetch.mock.calls.at(-1);
        expect(options.credentials).toBe('same-origin');
        expect(options.cache).toBe('no-store');
        expect(options.headers['X-CSRF-Token']).toBe('session-csrf');
        expect(options.headers['X-Instance-Id']).toBe('chosen');
        expect(options.headers.Authorization).toBeUndefined();
        expect(storage.has('caddy_ui_token')).toBe(false);
        expect([...storage.values()]).not.toContain('session-csrf');
    });
    it('does not mistake a permission failure for session expiration', async () => {
        const unauth = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ code: 'FORBIDDEN' }, 403)));
        await expect(api.apiFetch('/settings', {}, unauth)).rejects.toMatchObject({ status: 403 });
        expect(unauth).not.toHaveBeenCalled();
        fetch.mockResolvedValue(response({ code: 'UNAUTHORIZED' }, 401));
        await expect(api.apiFetch('/settings', {}, unauth)).rejects.toMatchObject({ status: 401 });
        expect(unauth).toHaveBeenCalledOnce();
    });
});

import { authErrorKey } from '../src/utils/authErrors.js';
it('uses the central auth error registry without accepting inherited property names', () => {
    expect(authErrorKey({ code: 'HTTPS_REQUIRED' })).toBe('auth.httpsRequired');
    expect(authErrorKey({ code: 'UNAUTHORIZED' })).toBe('login.failed');
    expect(authErrorKey({ code: '__proto__' })).toBe('auth.failed');
});
