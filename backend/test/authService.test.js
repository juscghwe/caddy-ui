import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authConfig } from '../src/auth/config.js';
import { openAuth, digest } from '../src/auth/service.js';
import { unwrapKey } from '../src/auth/keys.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const password = 'a sufficiently strong password';

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'caddy-auth-service-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const config = authConfig({ CADDY_UI_AUTH_DATA_PATH: join(root, 'state'), CADDY_UI_AUTH_KEY_PATH: join(root, 'key', 'runtime'), CADDY_UI_EXTERNAL_URL: 'https://ui.example.test' });
    let now = Date.now();
    const service = await openAuth(config, { clock: () => now });
    cleanups.push(() => service.close());
    return { service, config, advance: ms => { now += ms; } };
}
async function initialized() {
    const setup = await fixture();
    const code = await setup.service.setupCode();
    const recovery = await setup.service.claim({ code, username: 'Admin', password });
    const login = await setup.service.login('ADMIN', password);
    const session = await setup.service.session(login.token);
    return { ...setup, recovery, login, session };
}

describe('bootstrap and revocable administrator sessions', () => {
    it('accepts one claim, returns owner recovery material and stores no usable credentials', async () => {
        const { service, config } = await fixture();
        const code = await service.setupCode();
        const outcomes = await Promise.allSettled([1, 2].map(() => service.claim({ code, username: 'admin', password })));
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const result = outcomes.find(result => result.status === 'fulfilled').value;
        const bundle = JSON.parse(await readFile(join(config.dataPath, 'recovery.json'), 'utf8'));
        expect(unwrapKey(result.recoveryCode, bundle, result.installationId)).toEqual(service.key);
        await expect(service.setupCode()).rejects.toMatchObject({ code: 'SETUP_COMPLETE' });
        await expect(service.claim({ code, username: 'other', password })).rejects.toMatchObject({ code: 'SETUP_COMPLETE' });
        expect((await service.listUsers())).toHaveLength(1);
        const state = await service.state();
        expect(state.digest).toBeNull();
        expect(JSON.stringify(bundle)).not.toContain(result.recoveryCode);
    });

    it('expires setup codes and limits unsuccessful claims without rolling attempts back', async () => {
        const { service, advance } = await fixture();
        const code = await service.setupCode();
        for (let i = 0; i < 10; i++) await expect(service.claim({ code: 'wrong', username: 'admin', password })).rejects.toMatchObject({ code: 'SETUP_INVALID' });
        expect((await service.state()).attempts).toBe(10);
        await expect(service.claim({ code, username: 'admin', password })).rejects.toMatchObject({ code: 'SETUP_INVALID' });
        const replacement = await service.setupCode();
        advance(10 * 60_000);
        await expect(service.claim({ code: replacement, username: 'admin', password })).rejects.toMatchObject({ code: 'SETUP_INVALID' });
    });

    it('persists accounts and opaque sessions across service restart and revokes logout', async () => {
        const { service, login, config } = await initialized();
        const stored = await service.db.get('SELECT digest FROM sessions');
        expect(stored.digest).toBe(digest(login.token));
        expect(stored.digest).not.toBe(login.token);
        const second = await openAuth(config);
        try {
            const session = await second.session(login.token);
            expect(session.user.username).toBe('admin');
            expect(session.csrfToken).toBe(login.csrfToken);
            await second.logout(session);
            expect(await service.session(login.token)).toBeNull();
        } finally { await second.close(); }
    });

    it('enforces idle/absolute expiry and does not authenticate unknown or disabled users', async () => {
        const { service, login, advance, config } = await initialized();
        await expect(service.login('unknown', password)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(service.login('admin', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        advance(config.idleMs);
        expect(await service.session(login.token)).toBeNull();
        const replacement = await service.login('admin', password);
        advance(config.absoluteMs);
        expect(await service.session(replacement.token)).toBeNull();
    });

    it('protects the last administrator atomically and invalidates disabled sessions', async () => {
        const { service, session, login } = await initialized();
        await expect(service.setEnabled(session, session.user.id, false)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
        const other = await service.createUser(session, 'other', password);
        const otherLogin = await service.login('other', password);
        const otherSession = await service.session(otherLogin.token);
        const attempts = await Promise.allSettled([
            service.setEnabled(session, session.user.id, false),
            service.setEnabled(otherSession, other.id, false),
        ]);
        expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect((await service.listUsers()).filter(user => user.enabled)).toHaveLength(1);
        expect(await service.session(login.token)).toBeNull();
        await expect(service.createUser(session, 'revoked-actor', password)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('password changes revoke every session and personal preferences remain independent', async () => {
        const { service, session, login } = await initialized();
        const other = await service.createUser(session, 'other', password);
        await service.savePreferences(session.user.id, { language: 'en', theme: 'dark' });
        await service.savePreferences(other.id, { theme: 'light' });
        expect(await service.preferences(session.user.id)).toEqual({ language: 'en', theme: 'dark' });
        expect(await service.preferences(other.id)).toEqual({ theme: 'light' });
        const secondLogin = await service.login('admin', password);
        await expect(service.changePassword(session, 'wrong', 'another sufficiently long password')).rejects.toMatchObject({ code: 'AUTH_PASSWORD_INVALID' });
        await service.changePassword(session, password, 'another sufficiently long password');
        expect(await service.session(login.token)).toBeNull();
        expect(await service.session(secondLogin.token)).toBeNull();
        await expect(service.login('admin', password)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect((await service.login('admin', 'another sufficiently long password')).user.id).toBe(session.user.id);
    });

    it('refuses to reinitialize a deployment whose database or key disappeared', async () => {
        const { config, service } = await initialized();
        await service.close();
        await rm(config.keyPath);
        await expect(openAuth(config)).rejects.toThrow();
        await rm(join(config.dataPath, 'auth.sqlite'));
        await expect(openAuth(config)).rejects.toThrow('never automatic reinitialization');
    });
    it('refuses to repurpose a directory containing unrelated data', async () => {
        const { config } = await initialized();
        await writeFile(join(config.dataPath, 'unrelated.json'), '{}');
        await expect(openAuth(config)).rejects.toThrow('dedicated directory');
    });
});
