import argon2 from 'argon2';

const policy = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
let running = 0;

export function username(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value)) {
        throw Object.assign(new Error('Username must contain 1–64 ASCII letters, numbers, dots, underscores or hyphens'), { code: 'VALIDATION_FAILED' });
    }
    return value.toLowerCase();
}

export function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 1024) {
        throw Object.assign(new Error('Password must contain at least 12 characters and at most 1024 bytes'), { code: 'VALIDATION_FAILED' });
    }
    return value;
}

async function bounded(work) {
    if (running >= 2) throw Object.assign(new Error('Password verification is busy'), { code: 'RATE_LIMITED' });
    running++;
    try { return await work(); } finally { running--; }
}

export const hashPassword = value => bounded(() => argon2.hash(validatePassword(value), policy));
export const verifyPassword = (hash, value) => {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 1024) return Promise.resolve(false);
    return bounded(() => argon2.verify(hash, value));
};
export const needsRehash = hash => argon2.needsRehash(hash, policy);
