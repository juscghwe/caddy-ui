import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { requireOrigin, requireTransport } from './config.js';
import { asAppError } from '../AppError.js';
import { ERROR_REGISTRY } from '../errorRegistry.js';
import { sendAppError } from '../errorReporting.js';

const cookieName = '__Host-caddy_ui_session';
const flags = { secure: true, httpOnly: true, sameSite: 'strict', path: '/' };
const fail = code => Object.assign(new Error(code), { code });
export function cookieToken(req) {
    const matches = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(cookieName + '='));
    return matches.length === 1 ? matches[0].slice(cookieName.length + 1) : null;
}
function safeEqual(a, b) {
    if (typeof a !== 'string') return false;
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
function error(res, cause) {
    return sendAppError(res, asAppError(cause, Object.hasOwn(ERROR_REGISTRY, cause.code) ? cause.code : 'REQUEST_FAILED'));
}
const action = work => async (req, res) => { try { await work(req, res); } catch (cause) { error(res, cause); } };
const noStore = (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

export function createAuthMiddleware(auth, config) {
    return async (req, res, next) => {
        try {
            if (config.mode === 'disabled') return next();
            requireTransport(req, config);
            res.setHeader('Cache-Control', 'no-store');
            if (req.get('origin') && req.get('origin') !== config.origin) throw fail('FORBIDDEN');
            const token = cookieToken(req);
            if (Object.hasOwn(req.query, 'token') || req.headers.authorization !== undefined) throw fail('UNAUTHORIZED');
            const session = await auth.session(token);
            if (!session) throw fail('UNAUTHORIZED');
            req.session = session;
            req.user = session.user;
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
                requireOrigin(req, config);
                if (!safeEqual(req.get('x-csrf-token'), session.csrfToken)) throw fail('FORBIDDEN');
            }
            if (/^\/api\/logs\/(?:app\/)?stream$/.test(req.originalUrl.split('?')[0].replace(/\/+$/, ''))) {
                let checking = false;
                const check = async () => {
                    if (checking || res.writableEnded) return;
                    checking = true;
                    try { if (!await auth.session(token, { touch: false })) res.end(); }
                    catch { res.end(); }
                    finally { checking = false; }
                };
                const changed = userId => { if (userId === session.user.id) void check(); };
                const timer = setInterval(check, 5000);
                timer.unref();
                auth.revocations.on('changed', changed);
                res.once('close', () => { clearInterval(timer); auth.revocations.off('changed', changed); });
            }
            next();
        } catch (cause) { error(res, cause); }
    };
}

export function createAuthRouter(auth, config) {
    const router = Router();
    const guard = createAuthMiddleware(auth, config);
    router.use(noStore);
    const credentialLimit = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
        message: { code: 'RATE_LIMITED', error: 'Too many authentication attempts' } });
    const accountLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
        keyGenerator: req => typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 64) : 'invalid',
        message: { code: 'RATE_LIMITED', error: 'Too many authentication attempts' } });

    router.get('/status', action(async (req, res) => {
        if (!auth) return res.json({ authEnabled: false, initialized: true, secure: false, user: null });
        const initialized = Boolean((await auth.state()).initialized);
        let secure = false;
        try { requireTransport(req, config); secure = true; } catch { /* HTTP can read onboarding instructions only. */ }
        if (secure && req.get('origin') && req.get('origin') !== config.origin) throw fail('FORBIDDEN');
        const session = secure && !Object.hasOwn(req.query, 'token') && req.headers.authorization === undefined ? await auth.session(cookieToken(req)) : null;
        res.json({ authEnabled: true, initialized, secure, externalUrl: config.origin,
            user: session?.user || null, csrfToken: session?.csrfToken || null });
    }));
    router.post('/bootstrap', credentialLimit, action(async (req, res) => {
        requireOrigin(req, config);
        if (!auth) throw fail('FORBIDDEN');
        if (!req.is('application/json')) throw fail('VALIDATION_FAILED');
        res.status(201).json(await auth.claim(req.body || {}, req.diagnosticId));
    }));
    router.post('/sessions', credentialLimit, accountLimit, action(async (req, res) => {
        requireOrigin(req, config);
        if (!auth) throw fail('FORBIDDEN');
        if (!req.is('application/json')) throw fail('VALIDATION_FAILED');
        if (!(await auth.state()).initialized) throw fail('SETUP_REQUIRED');
        const login = await auth.login(req.body?.username, req.body?.password, req.diagnosticId);
        const previous = await auth.session(cookieToken(req), { touch: false });
        if (previous) await auth.logout(previous, req.diagnosticId);
        res.cookie(cookieName, login.token, { ...flags, maxAge: config.absoluteMs });
        res.json({ user: login.user, csrfToken: login.csrfToken });
    }));
    router.delete('/sessions/current', guard, action(async (req, res) => {
        if (!auth) throw fail('FORBIDDEN');
        await auth.logout(req.session, req.diagnosticId);
        res.clearCookie(cookieName, flags).json({ ok: true });
    }));
    router.get('/sessions', guard, action(async (req, res) => {
        if (!auth) throw fail('FORBIDDEN');
        res.json(await auth.listSessions(req.session));
    }));
    router.delete('/sessions/:id', guard, action(async (req, res) => {
        if (!auth) throw fail('FORBIDDEN');
        await auth.revokeSession(req.session, req.params.id, req.diagnosticId);
        if (req.params.id === req.session.digest) res.clearCookie(cookieName, flags);
        res.json({ ok: true });
    }));
    router.put('/password', guard, action(async (req, res) => {
        if (!auth) throw fail('FORBIDDEN');
        await auth.changePassword(req.session, req.body?.currentPassword, req.body?.password, req.diagnosticId);
        res.clearCookie(cookieName, flags).json({ ok: true });
    }));
    return router;
}

export function createAccountsRouter(auth, config) {
    const router = Router();
    router.use(noStore, createAuthMiddleware(auth, config), (req, res, next) => {
        if (!req.user || req.user.role !== 'administrator') return error(res, fail('FORBIDDEN'));
        next();
    });
    router.get('/', action(async (req, res) => res.json(await auth.listUsers())));
    router.post('/', action(async (req, res) => res.status(201).json(await auth.createUser(req.session, req.body?.username, req.body?.password, req.diagnosticId))));
    router.patch('/:id', action(async (req, res) => {
        await auth.setEnabled(req.session, req.params.id, req.body?.enabled, req.diagnosticId);
        res.json({ ok: true });
    }));
    return router;
}
