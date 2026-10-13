import { open, mkdir, lstat, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import sqlite from '@journeyapps/sqlcipher';

export async function openDatabase(file, key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 256-bit database key is required');
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    try {
        const handle = await open(file, 'wx', 0o600);
        await handle.close();
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Auth database must be a regular file');
    await chmod(file, 0o600);
    const native = await new Promise((resolve, reject) => {
        const db = new sqlite.Database(file, error => error ? reject(error) : resolve(db));
    });
    const db = {
        run(sql, params = []) {
            return new Promise((resolve, reject) => native.run(sql, params, function (error) {
                if (error) reject(error);
                else resolve({ changes: this.changes, lastID: this.lastID });
            }));
        },
        get(sql, params = []) {
            return new Promise((resolve, reject) => native.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
        },
        all(sql, params = []) {
            return new Promise((resolve, reject) => native.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
        },
        exec(sql) { return new Promise((resolve, reject) => native.exec(sql, error => error ? reject(error) : resolve())); },
        close() { return new Promise((resolve, reject) => native.close(error => error ? reject(error) : resolve())); },
    };
    let tail = Promise.resolve();
    db.exclusive = work => {
        const pending = tail.then(() => work(db));
        tail = pending.catch(() => {});
        return pending;
    };
    db.transaction = work => db.exclusive(async connection => {
        await connection.exec('BEGIN IMMEDIATE');
        try {
            const result = await work(connection);
            await connection.exec('COMMIT');
            return result;
        } catch (error) {
            await connection.exec('ROLLBACK');
            throw error;
        }
    });
    try {
        const provider = await db.get('PRAGMA cipher_version');
        if (!provider || !Object.values(provider).some(value => /^4\./.test(String(value)))) {
            throw new Error('SQLCipher 4 is required; plaintext SQLite is unsupported');
        }
        await db.exec(`PRAGMA cipher_compatibility = 4; PRAGMA key = "x'${key.toString('hex')}'";`);
        await db.get('SELECT count(*) FROM sqlite_master');
        await db.exec('PRAGMA cipher_memory_security = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY; PRAGMA secure_delete = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
        return db;
    } catch {
        await db.close();
        throw new Error('Cannot open encrypted auth database; check the provider/key or use local recovery');
    }
}

export async function migrate(db) {
    await db.transaction(async connection => {
        const { user_version: version } = await connection.get('PRAGMA user_version');
        if (version > 1) throw new Error('Auth database belongs to a newer application version');
        if (version === 1) return;
        await connection.exec(`
            CREATE TABLE users (
                id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
                role TEXT NOT NULL DEFAULT 'administrator' CHECK(role = 'administrator'),
                revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
            );
            CREATE TABLE password_credentials (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                hash TEXT NOT NULL, changed_at INTEGER NOT NULL
            );
            CREATE TABLE sessions (
                digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
                used_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
            );
            CREATE INDEX sessions_user ON sessions(user_id);
            CREATE TABLE bootstrap_state (
                id INTEGER PRIMARY KEY CHECK(id = 1), initialized INTEGER NOT NULL DEFAULT 0,
                digest TEXT, expires_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO bootstrap_state(id) VALUES(1);
            CREATE TABLE user_preferences (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                value TEXT NOT NULL
            );
            CREATE TABLE security_audit (
                id INTEGER PRIMARY KEY, time INTEGER NOT NULL,
                actor TEXT, action TEXT NOT NULL, target TEXT, request_id TEXT
            );
            PRAGMA user_version = 1;
        `);
    });
}
