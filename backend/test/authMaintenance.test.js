import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { authConfig } from '../src/auth/config.js';
import { openAuth } from '../src/auth/service.js';
import { openDatabase } from '../src/auth/database.js';
import { readKey, unwrapKey, privateWrite } from '../src/auth/keys.js';
import * as maintenance from '../src/auth/maintenance.js';
import { run, readSecret } from '../src/auth/cli.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const password = 'a sufficiently strong password';
async function fixture({ initialized = true } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'caddy-auth-maintenance-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const env = { CADDY_UI_AUTH_DATA_PATH: join(root, 'state'), CADDY_UI_AUTH_KEY_PATH: join(root, 'keys', 'runtime'), CADDY_UI_EXTERNAL_URL: 'https://ui.example.test' };
    const config = authConfig(env);
    let recovery, login;
    const service = await openAuth(config);
    try {
        if (initialized) {
            recovery = await service.claim({ code: await service.setupCode(), username: 'admin', password });
            login = await service.login('admin', password);
            await service.savePreferences(login.user.id, { theme: 'dark' });
        }
    } finally { await service.close(); }
    return { root, config, env, recovery, login };
}
async function opened(config, work) {
    const service = await openAuth(config);
    try { return await work(service); } finally { await service.close(); }
}

describe('local auth migration and recovery', () => {
    it('imports once, preserves the legacy identity, and activates only through setup claim', async () => {
        const { config } = await fixture({ initialized: false });
        const legacy = { CADDY_UI_USER: 'Legacy', CADDY_UI_PASSWORD: password, JWT_SECRET: 'obsolete-signing-key' };
        await maintenance.importLegacy(config, legacy);
        await expect(maintenance.importLegacy(config, legacy)).rejects.toThrow('already');
        await opened(config, async service => {
            const [user] = await service.listUsers();
            expect(user.username).toBe('legacy');
            expect((await service.state()).initialized).toBe(0);
            await expect(service.login('legacy', password)).rejects.toMatchObject({ code: 'SETUP_REQUIRED' });
            const code = await service.setupCode();
            await expect(service.claim({ code, username: 'override', password })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
            const recovered = await service.claim({ code });
            expect(recovered.recoveryCode).toMatch(/^cui-recovery-v1-/);
            expect((await service.login('legacy', password)).user.id).toBe(user.id);
        });
    });
    it('recovers a missing key, rejects wrong codes without writing it, and revokes sessions', async () => {
        const { config, recovery, login } = await fixture();
        const original = await readKey(config.keyPath);
        await rm(config.keyPath);
        await expect(openAuth(config)).rejects.toThrow();
        await expect(maintenance.recoverKey(config, { recoveryCode: 'cui-recovery-v1-' + randomBytes(32).toString('base64url') })).rejects.toThrow();
        await expect(stat(config.keyPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await maintenance.recoverKey(config, recovery);
        expect(await readKey(config.keyPath)).toEqual(original);
        expect((await stat(config.keyPath)).mode & 0o077).toBe(0);
        await opened(config, async service => {
            expect(await service.session(login.token)).toBeNull();
            expect((await service.login('admin', password)).user.id).toBe(login.user.id);
        });
        await expect(maintenance.recoverKey(config, recovery)).rejects.toThrow('already exists');
    });
    it('creates encrypted consistent backups without runtime keys and restores with revocation', async () => {
        const { root, config, recovery, login } = await fixture();
        const destination = join(root, 'backup');
        await maintenance.backup(config, destination);
        const bytes = await readFile(join(destination, 'auth.sqlite'));
        expect(bytes.subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
        expect(bytes.includes(Buffer.from('admin'))).toBe(false);
        await expect(stat(join(destination, 'database.key'))).rejects.toThrow();
        await expect(maintenance.backup(config, destination)).rejects.toThrow();
        await maintenance.resetPassword(config, 'admin', 'a different long password');
        await maintenance.restore(config, destination, recovery);
        await opened(config, async service => {
            expect(await service.session(login.token)).toBeNull();
            expect((await service.login('admin', password)).user.id).toBe(login.user.id);
            expect(await service.preferences(login.user.id)).toEqual({ theme: 'dark' });
            expect((await service.state()).digest).toBeNull();
        });
    });
    it('rotates the actual SQLCipher key, replaces owner recovery and preserves identities', async () => {
        const { config, recovery, login } = await fixture();
        const oldKey = await readKey(config.keyPath);
        const nextRecovery = await maintenance.rotateKey(config);
        const nextKey = await readKey(config.keyPath);
        expect(nextKey).not.toEqual(oldKey);
        await expect(openDatabase(join(config.dataPath, 'auth.sqlite'), oldKey)).rejects.toThrow();
        const bundle = JSON.parse(await readFile(join(config.dataPath, 'recovery.json'), 'utf8'));
        expect(unwrapKey(nextRecovery.recoveryCode, bundle, nextRecovery.installationId)).toEqual(nextKey);
        expect(() => unwrapKey(recovery.recoveryCode, bundle, recovery.installationId)).toThrow();
        await opened(config, async service => {
            expect(await service.session(login.token)).toBeNull();
            expect((await service.login('admin', password)).user.id).toBe(login.user.id);
            expect(await service.preferences(login.user.id)).toEqual({ theme: 'dark' });
        });
    });
    it('regenerates recovery and resets account credentials locally without keeping previous sessions', async () => {
        const { config, recovery, login } = await fixture();
        const exported = await maintenance.regenerateRecovery(config);
        const bundle = JSON.parse(await readFile(join(config.dataPath, 'recovery.json'), 'utf8'));
        expect(() => unwrapKey(recovery.recoveryCode, bundle, recovery.installationId)).toThrow();
        expect(unwrapKey(exported.recoveryCode, bundle, exported.installationId)).toEqual(await readKey(config.keyPath));
        await maintenance.resetPassword(config, 'admin', 'replacement long password');
        await opened(config, async service => {
            expect(await service.session(login.token)).toBeNull();
            await expect(service.login('admin', password)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
            expect((await service.login('admin', 'replacement long password')).user.id).toBe(login.user.id);
        });
    });
    it('fails closed during an interrupted transition and cancels only readable active state', async () => {
        const { config } = await fixture();
        await privateWrite(join(config.keyPath + '.transition', 'incomplete'), 'preparation');
        await expect(openAuth(config)).rejects.toThrow('Pending auth storage transition');
        await expect(maintenance.completeTransition(config)).rejects.toThrow();
        await maintenance.cancelTransition(config);
        await opened(config, async service => expect((await service.state()).initialized).toBe(1));
        await privateWrite(join(config.keyPath + '.transition', 'incomplete'), 'preparation');
        await writeFile(config.keyPath, randomBytes(32));
        await expect(maintenance.cancelTransition(config)).rejects.toThrow();
        expect((await stat(config.keyPath + '.transition')).isDirectory()).toBe(true);
    });
    it('completes a prepared transition after the active key replacement was interrupted', async () => {
        const { config, login } = await fixture();
        const directory = config.keyPath + '.transition';
        for (const file of ['auth.sqlite', 'installation.json', 'recovery.json']) {
            await privateWrite(join(directory, file), await readFile(join(config.dataPath, file)));
        }
        await privateWrite(join(directory, 'database.key'), await readKey(config.keyPath));
        await privateWrite(join(directory, 'ready.json'), JSON.stringify({ version: 1, dataPath: config.dataPath, keyPath: config.keyPath }));
        await privateWrite(config.keyPath, randomBytes(32));
        await expect(openAuth(config)).rejects.toThrow('Pending auth storage transition');
        await maintenance.completeTransition(config);
        await opened(config, async service => {
            expect(await service.session(login.token)).toBeNull();
            expect((await service.login('admin', password)).user.id).toBe(login.user.id);
        });
    });
    it('rejects incomplete legacy input and requires offline acknowledgment without secret arguments', async () => {
        const { env } = await fixture({ initialized: false });
        await expect(run(['setup-code'], { env })).rejects.toThrow('Stop the backend');
        await expect(run(['reset-password', 'admin', password, '--offline-confirmed'], { env })).rejects.toThrow('secrets must use stdin');
        await expect(run(['import-legacy', '--offline-confirmed'], { env })).rejects.toThrow('complete legacy');
        expect(await readSecret(Readable.from([password + '\n']))).toBe(password);
        await expect(readSecret(Readable.from(['x'.repeat(17000)]))).rejects.toThrow('too large');
    });
});
