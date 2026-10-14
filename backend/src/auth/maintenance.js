// Local deployment-owner operations. The server must be stopped before use.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, rm, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openAuth } from './service.js';
import { openDatabase } from './database.js';
import { privateWrite, readKey, wrapKey, unwrapKey } from './keys.js';
import { hashPassword, username } from './passwords.js';
import { isOutside } from './config.js';

const transitionPath = config => config.keyPath + '.transition';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sqlString = value => "'" + value.replaceAll("'", "''") + "'";
async function regular(file) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Maintenance input must be a regular file');
    return readFile(file);
}
async function invalidate(db) {
    await db.transaction(async connection => {
        await connection.exec('DELETE FROM sessions; UPDATE users SET revision=revision+1; UPDATE bootstrap_state SET digest=NULL,expires_at=NULL,attempts=0 WHERE id=1;');
    });
}
async function inspect(db) {
    const rows = await db.all('PRAGMA quick_check');
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok' || (await db.all('PRAGMA foreign_key_check')).length) throw new Error('Auth database integrity check failed');
    const { user_version: version } = await db.get('PRAGMA user_version');
    if (version !== 1) throw new Error('Unsupported auth backup schema');
}
export async function importLegacy(config, env) {
    if (![env.CADDY_UI_USER, env.CADDY_UI_PASSWORD, env.JWT_SECRET].every(value => typeof value === 'string' && value.length)) throw new Error('A complete legacy configuration is required');
    // Validate before provisioning any state. Preserve the identity until HTTPS claim.
    const name = username(env.CADDY_UI_USER);
    const hash = await hashPassword(env.CADDY_UI_PASSWORD);
    const service = await openAuth(config);
    try {
        await service.db.transaction(async db => {
            if ((await db.get('SELECT initialized FROM bootstrap_state WHERE id=1')).initialized || await db.get('SELECT id FROM users LIMIT 1')) throw new Error('Legacy import has already run or accounts already exist');
            const id = randomUUID();
            await db.run('INSERT INTO users(id,username,created_at) VALUES(?,?,?)', [id, name, Date.now()]);
            await db.run('INSERT INTO password_credentials(user_id,hash,changed_at) VALUES(?,?,?)', [id, hash, Date.now()]);
            await service.audit(db, 'legacy.imported', id, id);
        });
    } finally { await service.close(); }
}
export async function resetPassword(config, name, password) {
    const normalized = username(name);
    const hash = await hashPassword(password);
    const service = await openAuth(config);
    try {
        await service.db.transaction(async db => {
            if (!(await db.get('SELECT initialized FROM bootstrap_state WHERE id=1')).initialized) throw new Error('Complete HTTPS setup before account recovery');
            const user = await db.get('SELECT id FROM users WHERE username=?', [normalized]);
            if (!user) throw new Error('Unknown administrator');
            await db.run('UPDATE password_credentials SET hash=?,changed_at=? WHERE user_id=?', [hash, Date.now(), user.id]);
            await db.run('UPDATE users SET enabled=1,revision=revision+1 WHERE id=?', [user.id]);
            await db.run('DELETE FROM sessions');
            await service.audit(db, 'account.recovered', null, user.id);
        });
    } finally { await service.close(); }
}
export async function regenerateRecovery(config) {
    const service = await openAuth(config);
    try {
        if (!(await service.state()).initialized) throw new Error('Complete HTTPS setup before exporting recovery');
        const recovery = wrapKey(service.key, service.installationId);
        await privateWrite(join(config.dataPath, 'recovery.json'), JSON.stringify(recovery.bundle));
        await service.db.transaction(db => service.audit(db, 'recovery.rotated'));
        return { version: 1, installationId: service.installationId, recoveryCode: recovery.code };
    } finally { await service.close(); }
}
export async function recoverKey(config, recovery) {
    // Never provision new state or overwrite an existing key on a recovery attempt.
    try { await lstat(config.keyPath); throw new Error('Runtime key already exists; move it aside locally before recovery'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const marker = JSON.parse((await regular(join(config.dataPath, 'installation.json'))).toString());
    if (recovery.installationId && recovery.installationId !== marker.installationId) throw new Error('Recovery export belongs to another installation');
    const bundle = JSON.parse((await regular(join(config.dataPath, 'recovery.json'))).toString());
    const key = unwrapKey(recovery.recoveryCode, bundle, marker.installationId);
    let db;
    try {
        await regular(join(config.dataPath, 'auth.sqlite'));
        db = await openDatabase(join(config.dataPath, 'auth.sqlite'), key);
        await inspect(db);
        await invalidate(db);
        await db.close(); db = null;
        await mkdir(dirname(config.keyPath), { recursive: true, mode: 0o700 });
        if (!isOutside(await realpath(config.dataPath), await realpath(dirname(config.keyPath)))) throw new Error('Runtime key location must be separate');
        await privateWrite(config.keyPath, key);
    } finally { await db?.close(); key.fill(0); }
}
export async function backup(config, destination) {
    destination = resolve(destination);
    if (!isOutside(config.dataPath, destination) || !isOutside(destination, config.keyPath)) throw new Error('Backup must be separate from auth data and runtime key');
    const service = await openAuth(config);
    try {
        if (!(await service.state()).initialized) throw new Error('Complete setup before making an auth backup');
        const checkpoint = await service.db.get('PRAGMA wal_checkpoint(TRUNCATE)');
        if (checkpoint.busy) throw new Error('Stop other database users before backup');
        await service.close();
        await mkdir(destination, { mode: 0o700 }); // Never replace an existing backup.
        for (const file of ['auth.sqlite', 'installation.json', 'recovery.json']) await privateWrite(join(destination, file), await regular(join(config.dataPath, file)));
    } finally { await service.close(); }
}
async function stage(config, work) {
    const directory = transitionPath(config);
    await mkdir(directory, { mode: 0o700 }); // Existing/incomplete transition requires inspection.
    // Deliberately keep an interrupted preparation for local inspection, rather than guessing.
    await work(directory);
    await privateWrite(join(directory, 'ready.json'), JSON.stringify({ version: 1, dataPath: config.dataPath, keyPath: config.keyPath }));
}
export async function completeTransition(config) {
    const directory = transitionPath(config);
    const state = await json(join(directory, 'ready.json'));
    if (state.version !== 1 || state.dataPath !== config.dataPath || state.keyPath !== config.keyPath) throw new Error('Transition configuration mismatch');
    const key = await readKey(join(directory, 'database.key'));
    let db;
    try {
        db = await openDatabase(join(directory, 'auth.sqlite'), key);
        await inspect(db); await invalidate(db);
        await db.close(); db = null;
        const marker = await regular(join(directory, 'installation.json'));
        const bundle = await regular(join(directory, 'recovery.json'));
        if (JSON.parse(marker).installationId !== JSON.parse(bundle).installationId) throw new Error('Transition recovery metadata mismatch');
        await mkdir(config.dataPath, { recursive: true, mode: 0o700 });
        if (!isOutside(await realpath(config.dataPath), await realpath(dirname(config.keyPath)))) throw new Error('Runtime key location must be separate');
        // Every replacement is durable and repeatable. Startup refuses while the journal exists.
        for (const suffix of ['-wal', '-shm', '-journal']) await rm(join(config.dataPath, 'auth.sqlite') + suffix, { force: true });
        await privateWrite(join(config.dataPath, 'auth.sqlite'), await regular(join(directory, 'auth.sqlite')));
        await privateWrite(join(config.dataPath, 'installation.json'), marker);
        await privateWrite(join(config.dataPath, 'recovery.json'), bundle);
        await privateWrite(config.keyPath, key);
        await rm(directory, { recursive: true });
    } finally { await db?.close(); key.fill(0); }
}
export async function rotateKey(config) {
    const service = await openAuth(config);
    const nextKey = randomBytes(32);
    const recovery = wrapKey(nextKey, service.installationId);
    try {
        if (!(await service.state()).initialized) throw new Error('Complete setup before rotating the database key');
        await stage(config, async directory => {
            const candidate = join(directory, 'auth.sqlite');
            await privateWrite(candidate, Buffer.alloc(0));
            // SQLCipher export explicitly keys the destination; SQLite backup APIs may create plaintext.
            await service.db.exclusive(async db => {
                await db.exec(`ATTACH DATABASE ${sqlString(candidate)} AS rotated KEY "x'${nextKey.toString('hex')}'";`);
                try { await db.get("SELECT sqlcipher_export('rotated')"); await db.exec('PRAGMA rotated.user_version = 1;'); }
                finally { await db.exec('DETACH DATABASE rotated'); }
            });
            await privateWrite(join(directory, 'database.key'), nextKey);
            await privateWrite(join(directory, 'installation.json'), JSON.stringify({ installationId: service.installationId }));
            await privateWrite(join(directory, 'recovery.json'), JSON.stringify(recovery.bundle));
        });
        await service.close();
        await completeTransition(config);
        return { version: 1, installationId: service.installationId, recoveryCode: recovery.code };
    } finally { await service.close(); nextKey.fill(0); }
}
export async function restore(config, source, recovery) {
    source = resolve(source);
    const names = await readdir(source);
    if (!['auth.sqlite', 'installation.json', 'recovery.json'].every(file => names.includes(file))) throw new Error('Incomplete auth backup');
    const marker = JSON.parse((await regular(join(source, 'installation.json'))).toString());
    if (recovery.installationId && recovery.installationId !== marker.installationId) throw new Error('Recovery export belongs to another installation');
    const bundle = JSON.parse((await regular(join(source, 'recovery.json'))).toString());
    const key = unwrapKey(recovery.recoveryCode, bundle, marker.installationId);
    try {
        await mkdir(dirname(config.keyPath), { recursive: true, mode: 0o700 });
        await stage(config, async directory => {
            for (const file of ['auth.sqlite', 'installation.json', 'recovery.json']) await privateWrite(join(directory, file), await regular(join(source, file)));
            await privateWrite(join(directory, 'database.key'), key);
            const db = await openDatabase(join(directory, 'auth.sqlite'), key);
            try { await inspect(db); } finally { await db.close(); }
        });
        await completeTransition(config);
    } finally { key.fill(0); }
}
export async function cancelTransition(config) {
    // Cancellation is safe only while the original database is still readable with its key.
    const key = await readKey(config.keyPath);
    let db;
    try {
        db = await openDatabase(join(config.dataPath, 'auth.sqlite'), key);
        await inspect(db);
        const marker = await json(join(config.dataPath, 'installation.json'));
        const bundle = await json(join(config.dataPath, 'recovery.json'));
        if (marker.installationId !== bundle.installationId) throw new Error('Complete the transition; current metadata is inconsistent');
        await db.close(); db = null;
        await rm(transitionPath(config), { recursive: true });
    } finally { await db?.close(); key.fill(0); }
}
export async function setupCode(config) {
    const service = await openAuth(config);
    try { return await service.setupCode(); } finally { await service.close(); }
}
