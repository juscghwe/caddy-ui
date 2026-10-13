import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase, migrate } from '../src/auth/database.js';
import { hashPassword, verifyPassword, needsRehash, username } from '../src/auth/passwords.js';
import { wrapKey, unwrapKey, privateWrite, readKey } from '../src/auth/keys.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-auth-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const key = randomBytes(32);
    const file = join(directory, 'auth.sqlite');
    const db = await openDatabase(file, key);
    cleanups.push(() => db.close());
    await migrate(db);
    return { directory, key, file, db };
}

describe('encrypted identity foundation', () => {
    it('encrypts persisted records and WAL and refuses an absent/wrong key', async () => {
        const { db, file, key } = await fixture();
        await db.run('INSERT INTO users(id, username, created_at) VALUES(?, ?, ?)', ['id', 'private-identity-example', Date.now()]);
        for (const path of [file, file + '-wal']) {
            const bytes = await readFile(path);
            expect(bytes.includes(Buffer.from('private-identity-example'))).toBe(false);
            expect(bytes.subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
            expect((await stat(path)).mode & 0o077).toBe(0);
        }
        await expect(openDatabase(file, undefined)).rejects.toThrow('256-bit');
        await expect(openDatabase(file, randomBytes(32))).rejects.toThrow('Cannot open encrypted');
        const second = await openDatabase(file, key);
        try { expect((await second.get('SELECT username FROM users')).username).toBe('private-identity-example'); }
        finally { await second.close(); }
    });

    it('rolls back failed migrations/writes and preserves identity constraints', async () => {
        const { db } = await fixture();
        await expect(db.transaction(async connection => {
            await connection.run('INSERT INTO users(id, username, created_at) VALUES(?, ?, ?)', ['one', 'admin', 1]);
            await connection.run('INSERT INTO users(id, username, created_at) VALUES(?, ?, ?)', ['two', 'admin', 2]);
        })).rejects.toThrow();
        expect(await db.all('SELECT * FROM users')).toEqual([]);
        await migrate(db);
        await db.exec('PRAGMA user_version = 2');
        await expect(migrate(db)).rejects.toThrow('newer application');
    });

    it('recovers the key with an authenticated bundle and rejects tampering or another deployment', () => {
        const key = randomBytes(32);
        const { code, bundle } = wrapKey(key, 'deployment');
        expect(JSON.stringify(bundle)).not.toContain(code);
        expect(JSON.stringify(bundle)).not.toContain(key.toString('hex'));
        expect(unwrapKey(code, bundle, 'deployment')).toEqual(key);
        const other = wrapKey(key, 'deployment');
        expect(() => unwrapKey(other.code, bundle, 'deployment')).toThrow();
        expect(() => unwrapKey(code, bundle, 'other')).toThrow();
        const corrupt = { ...bundle, ciphertext: randomBytes(32).toString('base64url') };
        expect(() => unwrapKey(code, corrupt, 'deployment')).toThrow();
    });

    it('creates private runtime key files and rejects invalid key material', async () => {
        const { directory, key } = await fixture();
        const file = join(directory, 'secrets', 'key');
        await privateWrite(file, key);
        expect(await readKey(file)).toEqual(key);
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        await privateWrite(file, Buffer.from('not-a-database-key'));
        await expect(readKey(file)).rejects.toThrow('32 bytes');
    });

    it('uses salted Argon2id verifiers, validates input and normalizes unique names', async () => {
        const password = 'an adequately long password';
        const first = await hashPassword(password);
        const second = await hashPassword(password);
        expect(first).toMatch(/^\$argon2id\$v=19\$/);
        expect(Object.fromEntries(first.split('$')[3].split(',').map(parameter => {
            const [name, value] = parameter.split('=');
            return [name, Number(value)];
        }))).toEqual({ m: 65536, t: 3, p: 1 });
        expect(second).not.toBe(first);
        expect(await verifyPassword(first, password)).toBe(true);
        expect(await verifyPassword(first, 'wrong password')).toBe(false);
        expect(await verifyPassword(first, 'x'.repeat(1025))).toBe(false);
        expect(needsRehash(first)).toBe(false);
        await expect(hashPassword('short')).rejects.toThrow('12 characters');
        expect(username('Admin')).toBe('admin');
        expect(() => username('admin\n')).toThrow();
    });
});
