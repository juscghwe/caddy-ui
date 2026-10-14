import { Router } from 'express';
import { normalizeLanguageSetting } from '../languages.js';
import { sanitizeHostList } from '../routeChecks.js';
import { runRouteChecks } from '../routeMonitor.js';
import { getSettings, saveSettings, personalSettings, defaultPersonalSettings, PERSONAL_SETTINGS } from '../settings.js';

const router = Router();

async function combinedSettings(req) {
    if (!req.user) return getSettings();
    return { ...getSettings(), ...defaultPersonalSettings(), ...await req.app.locals.auth.preferences(req.user.id) };
}

router.get('/', async (req, res) => {
    res.json(await combinedSettings(req));
});

router.put('/', async (req, res) => {
    try {
        const allowed = ['firstTimeRun', 'theme', 'language', 'darkPalette', 'lightPalette', 'routeColumns', 'routeChecks', 'routeCheckExcludes'];
        const updates = {};
        for (const key of allowed) {
            if (key in req.body) updates[key] = req.body[key];
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid settings provided' });
        }
        if ('language' in updates) {
            updates.language = normalizeLanguageSetting(updates.language);
            if (updates.language === undefined) return res.status(400).json({ error: 'Unsupported language' });
        }
        if ('routeChecks' in updates) updates.routeChecks = updates.routeChecks === true;
        if ('routeCheckExcludes' in updates) updates.routeCheckExcludes = sanitizeHostList(updates.routeCheckExcludes);
        const wasChecking = getSettings().routeChecks;
        if (req.user) {
            const personal = personalSettings(updates);
            const shared = Object.fromEntries(Object.entries(updates).filter(([key]) => !PERSONAL_SETTINGS.includes(key)));
            if (Object.keys(personal).length) await req.app.locals.auth.savePreferences(req.user.id, personal, req.session);
            if (Object.keys(shared).length) await saveSettings(shared);
        } else await saveSettings(updates);
        const settings = await combinedSettings(req);
        if (settings.routeChecks && !wasChecking) runRouteChecks();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
