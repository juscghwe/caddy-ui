import express from 'express';
import rateLimit from 'express-rate-limit';
import { loadCustomThemes } from './customThemes.js';
import { getInstances, loadInstances } from './instances.js';
import logger from './logger.js';
import { diagnosticMiddleware, sendAppError } from './errorReporting.js';
import { AppError } from './AppError.js';
import { authConfig } from './auth/config.js';
import { openAuth } from './auth/service.js';
import { createAuthMiddleware, createAuthRouter, createAccountsRouter } from './auth/http.js';
import { startSetupServer } from './auth/setupServer.js';
import { instanceMiddleware } from './middleware/instance.js';
import { initMonitor } from './notifications.js';
import caddyfileRouter, { migrateLegacyHistory } from './routes/caddyfile.js';
import customThemesRouter from './routes/customThemes.js';
import healthRouter from './routes/health.js';
import instancesRouter from './routes/instances.js';
import logsRouter, { appLogsRouter } from './routes/logs.js';
import metricsRouter, { rawMetrics } from './routes/metrics.js';
import notificationsRouter from './routes/notifications.js';
import settingsRouter from './routes/settings.js';
import { initCaddyfileTitles } from './caddyfileTitles.js';
import routenotesRouter, { cleanupOrphanedNotes } from './routes/routenotes.js';
import routesRouter from './routes/routes.js';
import servernamesRouter from './routes/servernames.js';
import statusRouter from './routes/status.js';
import tlsRouter from './routes/tls.js';
import { startRouteMonitor } from './routeMonitor.js';
import { loadMaintenance } from './maintenance.js';
import { loadServerNames } from './serverNames.js';
import { loadSettings, getSettings, personalSettings } from './settings.js';
import { initUptimeHistory } from './uptimeHistory.js';
import { getUpdateInfo, noteFrontendVersion, startUpdateCheck } from './updateCheck.js';
import { startUpstreamMonitor } from './upstreamMonitor.js';
import { getEnabledLanguages } from './languages.js';

const config = authConfig();
await loadSettings();
const auth = await openAuth(config, { initialPreferences: personalSettings(getSettings()) });
const authMiddleware = createAuthMiddleware(auth, config);
const publicMetrics = config.publicMetrics;
const app = express();
app.locals.auth = auth;
const PORT = process.env.PORT || 3001;
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';
const APP_VERSION = process.env.APP_VERSION || 'dev';

app.set('trust proxy', config.proxies);
app.use(diagnosticMiddleware);

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const elapsed = Date.now() - start;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level](`${req.method} ${req.diagnosticPath}`, {
            status: res.statusCode,
            elapsed,
            ip: req.ip,
            requestId: req.diagnosticId,
        });
    });
    next();
});

const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});

app.use('/api', apiLimiter);

// Auth routes are always public
app.use('/api/auth', express.json({ limit: '4kb' }), createAuthRouter(auth, config));

// GET /api/version -- always public, non-sensitive. ?frontend=<version> lets
// the sidebar learn whether either image is behind (from the cached manifest)
app.get('/api/version', (req, res) => {
    const frontend = typeof req.query.frontend === 'string' ? req.query.frontend.slice(0, 64) : null;
    noteFrontendVersion(frontend);
    res.json({ version: APP_VERSION, update: getUpdateInfo({ backend: APP_VERSION, frontend }) });
});

app.get('/api/languages', (req, res) => res.json({ languages: getEnabledLanguages() }));
app.use('/api', (req, res, next) => {
    if (publicMetrics && req.method === 'GET' && ['/metrics', '/metrics/raw'].includes(req.path)) return next();
    return authMiddleware(req, res, next);
});
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));
app.use('/api/accounts', createAccountsRouter(auth, config));

// Instance, settings, and custom-theme routes require auth but not instance middleware
app.use('/api/instances', instancesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/custom-themes', customThemesRouter);

// GET /api/languages -- always public, non-sensitive
// caddy/ui application logs are global and must remain available even when
// there is no valid Caddy instance to attach to the request.
app.use('/api/logs/app', appLogsRouter);

// Instance middleware for all other routes
app.use('/api', instanceMiddleware);

// GET /api/metrics/raw -- Prometheus scrape endpoint
// Public if CADDY_UI_PUBLIC_METRICS=true, otherwise requires auth
app.get('/api/metrics/raw', rawMetrics);

// All other /api/* routes require auth if enabled

app.use('/api/caddyfile', caddyfileRouter);
app.use('/api/routes', routesRouter);
app.use('/api/status', statusRouter);
app.use('/api/logs', logsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/server-names', servernamesRouter);
app.use('/api/tls', tlsRouter);
app.use('/api/health', healthRouter);
app.use('/api/route-notes', routenotesRouter);
app.use('/api/notifications', notificationsRouter);

app.use((err, req, res, next) => {
    if (['entity.parse.failed', 'entity.too.large'].includes(err.type)) {
        return sendAppError(res, new AppError('VALIDATION_FAILED'));
    }
    logger.error(`Unhandled error`, { requestId: req.diagnosticId, method: req.method, path: req.diagnosticPath || req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
});

await loadInstances();
await migrateLegacyHistory();
await loadServerNames(getInstances().map(i => i.id));
await loadMaintenance();
await loadCustomThemes();
await initUptimeHistory();
startUpstreamMonitor();
startRouteMonitor();
startUpdateCheck();

const setup = await startSetupServer(auth, config);
if (auth && !(await auth.state()).initialized) {
    process.stdout.write('Caddy UI one-time setup code (10 minutes): ' + await auth.setupCode() + '\n');
    process.stdout.write('Open the configured HTTPS origin to create the initial administrator.\n');
} else if (!auth) process.stdout.write('WARNING: Authentication is explicitly disabled. Use only in an isolated trusted environment.\n');
const server = app.listen(PORT, () => {
    logger.info(`Caddy UI backend running`, { port: PORT, version: APP_VERSION });
    logger.info(`Caddy admin API`, { url: CADDY_ADMIN_URL });
    logger.info(`Caddyfile path`, { path: process.env.CADDY_CONFIG_PATH || '/etc/caddy/Caddyfile' });
    logger.info(`Public metrics`, { enabled: publicMetrics });
    logger.info(`Enabled languages`, { languages: getEnabledLanguages() });
    initMonitor();
    initCaddyfileTitles().then(() => cleanupOrphanedNotes());
});

let stopping = false;
async function shutdown() {
    if (stopping) return;
    stopping = true;
    await setup?.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await auth?.close();
    process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
