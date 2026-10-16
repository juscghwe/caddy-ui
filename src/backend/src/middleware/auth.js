import jwt from 'jsonwebtoken';

const CADDY_UI_USER = process.env.CADDY_UI_USER;
const CADDY_UI_PASSWORD = process.env.CADDY_UI_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_METRICS = process.env.CADDY_UI_PUBLIC_METRICS === 'true';

// Only a fully unset configuration opts out of authentication. Validate during
// module initialization, before index.js can create or listen on the API server.
const authValues = { CADDY_UI_USER, CADDY_UI_PASSWORD, JWT_SECRET };
const provided = Object.keys(authValues).filter(name => authValues[name] !== undefined);
const invalid = Object.keys(authValues).filter(name => !authValues[name]?.trim());
if (provided.length && invalid.length) {
    throw new Error([
        'Authentication configuration is incomplete or invalid. Refusing to start.',
        `Provided variable names: ${provided.join(', ')}.`,
        `Missing, empty or whitespace-only: ${invalid.join(', ')}.`,
        'Set CADDY_UI_USER, CADDY_UI_PASSWORD and JWT_SECRET to enable authentication.',
        'To intentionally disable authentication, remove all three variables.',
        'Earlier versions could silently disable authentication when values were missing or empty.',
    ].join('\n'));
}

export const authEnabled = provided.length === Object.keys(authValues).length;
export const publicMetrics = PUBLIC_METRICS;

export function authMiddleware(req, res, next) {
    if (!authEnabled) return next();

    if (PUBLIC_METRICS && req.path === '/metrics') return next();

    const queryToken = req.query.token;
    const header = req.headers['authorization'];
    const token = queryToken || (header?.startsWith('Bearer ') ? header.slice(7) : null);

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
