import { isIP } from 'node:net';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export function isOutside(directory, path) {
    const separation = relative(directory, path);
    return separation === '..' || separation.startsWith('..' + sep) || isAbsolute(separation);
}

export function authConfig(env = process.env, { migration = false } = {}) {
    const mode = env.CADDY_UI_AUTH_MODE || 'required';
    if (!['required', 'disabled'].includes(mode)) throw new Error('CADDY_UI_AUTH_MODE must be required or disabled');
    const legacy = ['CADDY_UI_USER', 'CADDY_UI_PASSWORD', 'JWT_SECRET'].filter(name => Boolean(env[name]));
    if (legacy.length && legacy.length !== 3) throw new Error('Incomplete legacy auth configuration; never disabling authentication');
    if (legacy.length && !migration) throw new Error('Legacy auth configuration requires the local auth import-legacy command; remove legacy variables after import');
    const dataPath = resolve(env.CADDY_UI_AUTH_DATA_PATH || '/etc/caddy-ui/auth');
    if (dataPath === '/') throw new Error('Auth data needs a dedicated directory');
    const keyPath = resolve(env.CADDY_UI_AUTH_KEY_PATH || '/etc/caddy-ui-keys/database.key');
    if (!isOutside(dataPath, keyPath)) throw new Error('Database key must be outside the auth data directory');
    let origin = null;
    if (env.CADDY_UI_EXTERNAL_URL) {
        const url = new URL(env.CADDY_UI_EXTERNAL_URL);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            throw new Error('CADDY_UI_EXTERNAL_URL must be an HTTPS origin without credentials, path, query or fragment');
        }
        origin = url.origin;
    }
    const proxies = (env.CADDY_UI_TRUSTED_PROXIES || 'loopback').split(',').map(value => value.trim()).filter(Boolean);
    for (const proxy of proxies) {
        if (proxy === 'loopback') continue;
        const [address, mask, extra] = proxy.split('/');
        const family = isIP(address);
        if (!family || extra || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) < 1 || Number(mask) > (family === 4 ? 32 : 128)))) {
            throw new Error('CADDY_UI_TRUSTED_PROXIES must contain explicit IP addresses/CIDRs or loopback');
        }
    }
    const setupPort = Number(env.CADDY_UI_SETUP_PORT || 0);
    if (!Number.isInteger(setupPort) || setupPort < 0 || setupPort > 65535) throw new Error('Invalid CADDY_UI_SETUP_PORT');
    return {
        mode, dataPath, keyPath, origin, proxies, setupPort,
        setupHost: env.CADDY_UI_SETUP_HOST || '127.0.0.1',
        certificatePath: env.CADDY_UI_SETUP_CA_PATH ? resolve(env.CADDY_UI_SETUP_CA_PATH) : null,
        idleMs: 30 * 60_000, absoluteMs: 12 * 60 * 60_000,
    };
}

export function requireTransport(req, config) {
    if (config.mode === 'disabled') return;
    if (!config.origin || !req.secure || req.get('host') !== new URL(config.origin).host) {
        throw Object.assign(new Error('Configure the HTTPS origin and trusted proxy before authenticating'), { code: 'HTTPS_REQUIRED' });
    }
}

export function requireOrigin(req, config) {
    requireTransport(req, config);
    if (config.mode !== 'disabled' && req.get('origin') !== config.origin) {
        throw Object.assign(new Error('Invalid request origin'), { code: 'FORBIDDEN' });
    }
}
