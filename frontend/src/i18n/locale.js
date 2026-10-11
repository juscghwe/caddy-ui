/**
 * Tiny dedicated module for decreased scatter of environment parsing.
 */

export function getAdditionalLanguages() {
    const raw = process.env.CADDY_UI_ADDITIONAL_LANGUAGES || '';

    return [...new Set(
        raw
            .split(',')
            .map(lang => lang.trim().toLowerCase())
            .filter(lang => /^[a-z]{2,3}$/.test(lang))
            .filter(lang => lang !== 'en')
    )];
}

export function getEnabledLanguages() {
    return ['en', ...getAdditionalLanguages()];
}