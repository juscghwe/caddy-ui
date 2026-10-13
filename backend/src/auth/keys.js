import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, open, rename, lstat, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function privateWrite(file, data) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
}

export async function readKey(file) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) {
        throw new Error('Database key must be a private regular file (0400 or 0600)');
    }
    const key = await readFile(file);
    if (key.length !== 32) throw new Error('Database key must contain exactly 32 bytes');
    return key;
}

function recoveryKey(code, salt) {
    if (typeof code !== 'string' || !/^cui-recovery-v1-[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Invalid recovery code');
    return Buffer.from(hkdfSync('sha256', Buffer.from(code.slice(16), 'base64url'), salt, 'caddy-ui/database-recovery/v1', 32));
}

export function wrapKey(key, installationId) {
    const code = 'cui-recovery-v1-' + randomBytes(32).toString('base64url');
    const salt = randomBytes(32);
    const nonce = randomBytes(12);
    const kek = recoveryKey(code, salt);
    try {
        const cipher = createCipheriv('aes-256-gcm', kek, nonce);
        const metadata = { version: 1, installationId };
        cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
        const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
        return { code, bundle: { ...metadata, salt: salt.toString('base64url'), nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') } };
    } finally { kek.fill(0); }
}

export function unwrapKey(code, bundle, installationId) {
    if (bundle.version !== 1 || bundle.installationId !== installationId) throw new Error('Recovery bundle belongs to another installation');
    const kek = recoveryKey(code, Buffer.from(bundle.salt, 'base64url'));
    try {
        const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(bundle.nonce, 'base64url'));
        decipher.setAAD(Buffer.from(JSON.stringify({ version: 1, installationId })));
        decipher.setAuthTag(Buffer.from(bundle.tag, 'base64url'));
        const key = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, 'base64url')), decipher.final()]);
        if (key.length !== 32) throw new Error('Invalid recovered key');
        return key;
    } finally { kek.fill(0); }
}
