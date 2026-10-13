import { createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, lstat, rm, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { openDatabase, migrate } from './database.js';
import { privateWrite, readKey, wrapKey } from './keys.js';
import { hashPassword, verifyPassword, needsRehash, username } from './passwords.js';
import { isOutside } from './config.js';
import { EventEmitter } from 'node:events';

export const digest = value => createHash('sha256').update(value).digest('hex');
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const sameDigest = (a, b) => typeof a === 'string' && typeof b === 'string'
    && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const publicUser = row => ({ id: row.id, username: row.username, role: row.role, enabled: Boolean(row.enabled) });

async function exists(file) {
    try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function openAuth(config, { clock = Date.now } = {}) {
    if (config.mode === 'disabled') return null;
    await mkdir(config.dataPath, { recursive: true, mode: 0o700 });
    if (!(await lstat(config.dataPath)).isDirectory() || (await lstat(config.dataPath)).isSymbolicLink()) throw new Error('Auth directory must be a real directory');
    await chmod(config.dataPath, 0o700);
    await mkdir(dirname(config.keyPath), { recursive: true, mode: 0o700 });
    if (!isOutside(await realpath(config.dataPath), await realpath(dirname(config.keyPath)))) throw new Error('Database key location must be separate from the auth directory');
    const lock = join(config.dataPath, 'provision.lock');
    await mkdir(lock).catch(() => { throw new Error('Auth provisioning is already running or crashed; inspect provision.lock locally'); });
    let db;
    let key;
    try {
        const markerPath = join(config.dataPath, 'installation.json');
        const databasePath = join(config.dataPath, 'auth.sqlite');
        const hasMarker = await exists(markerPath);
        const hasDatabase = await exists(databasePath);
        if (hasMarker !== hasDatabase) throw new Error('Incomplete/missing auth storage; use local recovery, never automatic reinitialization');
        if (!hasMarker) {
            if (await exists(config.keyPath)) throw new Error('Existing key without auth installation; explicit local recovery is required');
            key = randomBytes(32);
            await privateWrite(config.keyPath, key);
            await privateWrite(markerPath, JSON.stringify({ installationId: randomUUID() }));
        } else key = await readKey(config.keyPath);
        const markerStat = await lstat(markerPath);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('Invalid installation marker');
        const { installationId } = JSON.parse(await readFile(markerPath, 'utf8'));
        if (typeof installationId !== 'string' || !/^[a-f0-9-]{36}$/.test(installationId)) throw new Error('Invalid installation identity');
        db = await openDatabase(databasePath, key);
        await migrate(db);
        const service = new AuthService(config, db, key, installationId, clock);
        service.dummyHash = await hashPassword(randomBytes(32).toString('hex'));
        return service;
    } catch (error) {
        if (db) await db.close();
        key?.fill(0);
        throw error;
    } finally { await rm(lock, { recursive: true }); }
}

export class AuthService {
    constructor(config, db, key, installationId, clock) {
        Object.assign(this, { config, db, key, installationId, clock });
        this.csrfKey = Buffer.from(hkdfSync('sha256', key, installationId, 'caddy-ui/csrf/v1', 32));
        this.revocations = new EventEmitter();
        this.revocations.setMaxListeners(0);
    }

    close() { return this.closing ??= this.db.exclusive(db => db.close()).finally(() => { this.key.fill(0); this.csrfKey.fill(0); }); }
    state() { return this.db.exclusive(db => db.get('SELECT * FROM bootstrap_state WHERE id=1')); }
    async audit(db, action, actor = null, target = null, requestId = null) {
        await db.run('INSERT INTO security_audit(time, actor, action, target, request_id) VALUES(?,?,?,?,?)', [this.clock(), actor, action, target, requestId]);
        await db.run('DELETE FROM security_audit WHERE time < ?', [this.clock() - 90 * 24 * 60 * 60_000]);
        await db.run('DELETE FROM security_audit WHERE id NOT IN (SELECT id FROM security_audit ORDER BY id DESC LIMIT 10000)');
    }
    async assertSession(db, session) {
        const row = await db.get('SELECT s.*,u.enabled,u.revision AS current_revision FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.user_id=?', [session.digest, session.user.id]);
        if (!row || !row.enabled || row.revision !== row.current_revision || row.expires_at <= this.clock() || row.used_at <= this.clock() - this.config.idleMs) throw failure('UNAUTHORIZED');
    }
    async setupCode() {
        const code = 'cui-setup-v1-' + randomBytes(32).toString('base64url');
        await this.db.transaction(async db => {
            if ((await db.get('SELECT initialized FROM bootstrap_state WHERE id=1')).initialized) throw failure('SETUP_COMPLETE');
            await db.run('UPDATE bootstrap_state SET digest=?, expires_at=?, attempts=0 WHERE id=1', [digest(code), this.clock() + 10 * 60_000]);
        });
        return code;
    }
    async claim({ code, username: name, password }, requestId) {
        const accepted = await this.db.transaction(async db => {
            const state = await db.get('SELECT * FROM bootstrap_state WHERE id=1');
            if (state.initialized) throw failure('SETUP_COMPLETE');
            if (typeof code !== 'string' || code.length > 128 || state.attempts >= 10 || state.expires_at <= this.clock()
                || !sameDigest(state.digest, digest(code))) {
                await db.run('UPDATE bootstrap_state SET attempts=attempts+1 WHERE id=1');
                await this.audit(db, 'setup.denied', null, null, requestId);
                return false;
            }
            return true;
        });
        if (!accepted) throw failure('SETUP_INVALID');
        const normalized = username(name);
        const hash = await hashPassword(password);
        const id = randomUUID();
        const recovery = wrapKey(this.key, this.installationId);
        await this.db.transaction(async db => {
            const state = await db.get('SELECT * FROM bootstrap_state WHERE id=1');
            if (state.initialized) throw failure('SETUP_COMPLETE');
            if (state.expires_at <= this.clock() || state.attempts >= 10 || !sameDigest(state.digest, digest(code))) throw failure('SETUP_INVALID');
            await privateWrite(join(this.config.dataPath, 'recovery.json'), JSON.stringify(recovery.bundle));
            await db.run('INSERT INTO users(id, username, created_at) VALUES(?,?,?)', [id, normalized, this.clock()]);
            await db.run('INSERT INTO password_credentials(user_id, hash, changed_at) VALUES(?,?,?)', [id, hash, this.clock()]);
            await db.run('UPDATE bootstrap_state SET initialized=1,digest=NULL,expires_at=NULL WHERE id=1');
            await this.audit(db, 'setup.completed', id, id, requestId);
        });
        return { recoveryCode: recovery.code, installationId: this.installationId };
    }

    async login(name, password, requestId) {
        let normalized;
        try { normalized = username(name); } catch { normalized = ''; }
        const user = await this.db.exclusive(db => db.get('SELECT u.*,p.hash FROM users u JOIN password_credentials p ON u.id=p.user_id WHERE username=?', [normalized]));
        const valid = await verifyPassword(user?.hash || this.dummyHash, password);
        if (!valid || !user?.enabled) {
            await this.db.transaction(db => this.audit(db, 'login.denied', null, null, requestId));
            throw failure('UNAUTHORIZED');
        }
        const rehashed = needsRehash(user.hash) ? await hashPassword(password) : null;
        const token = randomBytes(32).toString('base64url');
        await this.db.transaction(async db => {
            const current = await db.get('SELECT u.*,p.hash FROM users u JOIN password_credentials p ON u.id=p.user_id WHERE u.id=?', [user.id]);
            if (!current?.enabled || current.revision !== user.revision || current.hash !== user.hash) throw failure('UNAUTHORIZED');
            if (rehashed) await db.run('UPDATE password_credentials SET hash=? WHERE user_id=?', [rehashed, user.id]);
            const now = this.clock();
            await db.run('DELETE FROM sessions WHERE expires_at <= ? OR used_at <= ?', [now, now - this.config.idleMs]);
            await db.run('INSERT INTO sessions VALUES(?,?,?,?,?,?)', [digest(token), user.id, user.revision, now, now, now + this.config.absoluteMs]);
            await this.audit(db, 'login.succeeded', user.id, null, requestId);
        });
        return { token, user: publicUser(user), csrfToken: this.csrf(digest(token)) };
    }
    csrf(sessionDigest) { return createHmac('sha256', this.csrfKey).update(sessionDigest).digest('base64url'); }
    async session(token, { touch = true } = {}) {
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        return this.db.transaction(async db => {
            const sessionDigest = digest(token);
            const row = await db.get('SELECT s.*,u.id,u.username,u.enabled,u.role,u.revision AS current_revision FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=?', [sessionDigest]);
            const now = this.clock();
            if (!row || !row.enabled || row.revision !== row.current_revision || row.expires_at <= now || row.used_at <= now - this.config.idleMs) {
                await db.run('DELETE FROM sessions WHERE digest=?', [sessionDigest]);
                return null;
            }
            if (touch) await db.run('UPDATE sessions SET used_at=? WHERE digest=?', [now, sessionDigest]);
            return { user: publicUser(row), digest: sessionDigest, createdAt: row.created_at, csrfToken: this.csrf(sessionDigest) };
        });
    }
    async logout(session, requestId) {
        await this.db.transaction(async db => {
            await db.run('DELETE FROM sessions WHERE digest=?', [session.digest]);
            await this.audit(db, 'session.revoked', session.user.id, null, requestId);
        });
        this.revocations.emit('changed', session.user.id);
    }
    listSessions(session) {
        return this.db.transaction(async db => {
            await this.assertSession(db, session);
            return (await db.all('SELECT digest,created_at,used_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? AND used_at>? ORDER BY created_at DESC', [session.user.id, this.clock(), this.clock() - this.config.idleMs]))
                .map(row => ({ id: row.digest, createdAt: row.created_at, usedAt: row.used_at, expiresAt: row.expires_at, current: row.digest === session.digest }));
        });
    }
    async revokeSession(session, id, requestId) {
        await this.db.transaction(async db => {
            await this.assertSession(db, session);
            const result = await db.run('DELETE FROM sessions WHERE digest=? AND user_id=?', [id, session.user.id]);
            if (!result.changes) throw failure('NOT_FOUND');
            await this.audit(db, 'session.revoked', session.user.id, null, requestId);
        });
        this.revocations.emit('changed', session.user.id);
    }
    async changePassword(session, currentPassword, password, requestId) {
        const row = await this.db.exclusive(db => db.get('SELECT p.hash,u.revision FROM password_credentials p JOIN users u ON u.id=p.user_id WHERE p.user_id=?', [session.user.id]));
        if (!row || !await verifyPassword(row.hash, currentPassword)) throw failure('AUTH_PASSWORD_INVALID');
        const hash = await hashPassword(password);
        await this.db.transaction(async db => {
            await this.assertSession(db, session);
            const current = await db.get('SELECT revision,enabled FROM users WHERE id=?', [session.user.id]);
            if (!current?.enabled || current.revision !== row.revision) throw failure('UNAUTHORIZED');
            await db.run('UPDATE password_credentials SET hash=?,changed_at=? WHERE user_id=?', [hash, this.clock(), session.user.id]);
            await db.run('UPDATE users SET revision=revision+1 WHERE id=?', [session.user.id]);
            await db.run('DELETE FROM sessions WHERE user_id=?', [session.user.id]);
            await this.audit(db, 'password.changed', session.user.id, session.user.id, requestId);
        });
        this.revocations.emit('changed', session.user.id);
    }
    listUsers() { return this.db.exclusive(async db => (await db.all('SELECT * FROM users ORDER BY username')).map(publicUser)); }
    async createUser(session, name, password, requestId) {
        if (this.clock() - session.createdAt > 5 * 60_000) throw failure('AUTH_REAUTH_REQUIRED');
        const normalized = username(name);
        const hash = await hashPassword(password);
        const id = randomUUID();
        await this.db.transaction(async db => {
            await this.assertSession(db, session);
            if (await db.get('SELECT id FROM users WHERE username=?', [normalized])) throw failure('CONFLICT');
            await db.run('INSERT INTO users(id,username,created_at) VALUES(?,?,?)', [id, normalized, this.clock()]);
            await db.run('INSERT INTO password_credentials(user_id,hash,changed_at) VALUES(?,?,?)', [id, hash, this.clock()]);
            await this.audit(db, 'account.created', session.user.id, id, requestId);
        });
        return { id, username: normalized, role: 'administrator', enabled: true };
    }
    async setEnabled(session, id, enabled, requestId) {
        if (typeof enabled !== 'boolean') throw failure('VALIDATION_FAILED');
        if (this.clock() - session.createdAt > 5 * 60_000) throw failure('AUTH_REAUTH_REQUIRED');
        await this.db.transaction(async db => {
            await this.assertSession(db, session);
            if (!await db.get('SELECT id FROM users WHERE id=?', [id])) throw failure('NOT_FOUND');
            if (!enabled && (await db.get('SELECT count(*) AS n FROM users WHERE enabled=1 AND id<>?', [id])).n === 0) throw failure('LAST_ADMIN');
            await db.run('UPDATE users SET enabled=?,revision=revision+1 WHERE id=?', [Number(enabled), id]);
            await db.run('DELETE FROM sessions WHERE user_id=?', [id]);
            await this.audit(db, enabled ? 'account.enabled' : 'account.disabled', session.user.id, id, requestId);
        });
        this.revocations.emit('changed', id);
    }
    preferences(userId) { return this.db.exclusive(async db => JSON.parse((await db.get('SELECT value FROM user_preferences WHERE user_id=?', [userId]))?.value || '{}')); }
    async savePreferences(userId, updates) {
        return this.db.transaction(async db => {
            const value = { ...JSON.parse((await db.get('SELECT value FROM user_preferences WHERE user_id=?', [userId]))?.value || '{}'), ...updates };
            await db.run('INSERT INTO user_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value', [userId, JSON.stringify(value)]);
            return value;
        });
    }
}
