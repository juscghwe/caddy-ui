import { describe, expect, it } from 'vitest';
import { authConfig, requireOrigin, requireTransport } from '../src/auth/config.js';

describe('fail-closed authentication configuration', () => {
    it('requires auth unless disabling it is explicit', () => {
        expect(authConfig({}).mode).toBe('required');
        expect(authConfig({ CADDY_UI_AUTH_MODE: 'disabled' }).mode).toBe('disabled');
        expect(() => authConfig({ CADDY_UI_AUTH_MODE: 'typo' })).toThrow();
        for (const values of [{ CADDY_UI_USER: 'admin' }, { CADDY_UI_USER: 'admin', CADDY_UI_PASSWORD: 'password' }]) {
            expect(() => authConfig(values)).toThrow('Incomplete');
            expect(() => authConfig({ ...values, CADDY_UI_AUTH_MODE: 'disabled' })).toThrow('Incomplete');
        }
    });
    it('requires an explicit local migration for complete legacy credentials', () => {
        const env = { CADDY_UI_USER: 'admin', CADDY_UI_PASSWORD: 'password', JWT_SECRET: 'secret' };
        expect(() => authConfig(env)).toThrow('import-legacy');
        expect(authConfig(env, { migration: true }).mode).toBe('required');
    });
    it('rejects insecure origins, broad implicit trust, and keys inside the database directory', () => {
        for (const origin of ['http://example.test', 'https://example.test/path', 'https://user:password@example.test']) {
            expect(() => authConfig({ CADDY_UI_EXTERNAL_URL: origin })).toThrow();
        }
        expect(() => authConfig({ CADDY_UI_TRUSTED_PROXIES: '1' })).toThrow();
        expect(() => authConfig({ CADDY_UI_TRUSTED_PROXIES: '0.0.0.0/0' })).toThrow();
        expect(() => authConfig({ CADDY_UI_TRUSTED_PROXIES: '192.0.2.1/33' })).toThrow();
        expect(authConfig({ CADDY_UI_TRUSTED_PROXIES: 'loopback,192.0.2.1/32,::1/128' }).proxies).toHaveLength(3);
        expect(() => authConfig({ CADDY_UI_AUTH_DATA_PATH: '/private', CADDY_UI_AUTH_KEY_PATH: '/private/key' })).toThrow('outside');
        expect(() => authConfig({ CADDY_UI_AUTH_DATA_PATH: '/private', CADDY_UI_AUTH_KEY_PATH: '/private/..secret/key' })).toThrow('outside');
    });
    it('enforces HTTPS, canonical host and exact browser origin independently of account state', () => {
        const config = authConfig({ CADDY_UI_EXTERNAL_URL: 'https://ui.example.test:8443' });
        const req = { secure: true, get: name => ({ host: 'ui.example.test:8443', origin: config.origin })[name] };
        expect(() => requireOrigin(req, config)).not.toThrow();
        expect(() => requireTransport({ ...req, secure: false }, config)).toThrow();
        expect(() => requireOrigin({ ...req, get: name => name === 'origin' ? 'https://evil.test' : 'ui.example.test:8443' }, config)).toThrow('origin');
        expect(() => requireTransport({ ...req, get: () => 'evil.test' }, config)).toThrow();
    });
});
