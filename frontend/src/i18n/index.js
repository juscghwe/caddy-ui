import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.js';

const localeModules = import.meta.glob('./locales/*.js');

export const availableLocales = Object.keys(localeModules)
    .map(path => path.match(/\/([^/]+)\.js$/)?.[1])
    .filter(Boolean);

i18n
    .use(initReactI18next)
    .init({
        lng: 'en',
        fallbackLng: 'en',
        resources: {
            en: {
                translation: en,
            },
        },
        interpolation: {
            escapeValue: false,
        },
    });

export async function loadLocale(locale) {
    const normalized = locale.toLowerCase();

    if (normalized === 'en') {
        await i18n.changeLanguage('en');
        return;
    }

    const path = `./locales/${normalized}.js`;
    const loader = localeModules[path];

    if (!loader) {
        await i18n.changeLanguage('en');
        return;
    }

    if (!i18n.hasResourceBundle(normalized, 'translation')) {
        const module = await loader();
        i18n.addResourceBundle(
            normalized,
            'translation',
            module.default,
            true,
            true,
        );
    }

    await i18n.changeLanguage(normalized);
}

export default i18n;