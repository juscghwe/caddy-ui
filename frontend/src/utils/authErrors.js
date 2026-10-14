/* eslint-disable i18next/no-literal-string -- Registry values are translation keys, not display copy */
import { ERROR_MESSAGES } from './errorRegistry.js';
// Credential forms use context-specific copy; shared codes retain the central registry.
const keys = {
    UNAUTHORIZED: 'login.failed', VALIDATION_FAILED: 'auth.validationFailed',
    FORBIDDEN: 'auth.forbidden', CONFLICT: 'auth.conflict',
    RATE_LIMITED: 'auth.rateLimited', NETWORK_ERROR: 'login.serverUnreachable',
};
export const authErrorKey = error => Object.hasOwn(keys, error?.code) ? keys[error.code]
    : Object.hasOwn(ERROR_MESSAGES, error?.code) ? ERROR_MESSAGES[error.code] : 'auth.failed';
