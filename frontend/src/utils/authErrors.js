/* eslint-disable i18next/no-literal-string -- Registry values are translation keys, not display copy */
const keys = {
    UNAUTHORIZED: 'login.failed', SETUP_INVALID: 'auth.setupInvalid', SETUP_COMPLETE: 'auth.setupComplete',
    VALIDATION_FAILED: 'auth.validationFailed', HTTPS_REQUIRED: 'auth.httpsRequired',
    FORBIDDEN: 'auth.forbidden', LAST_ADMIN: 'auth.lastAdmin', CONFLICT: 'auth.conflict',
    AUTH_REAUTH_REQUIRED: 'auth.reauthRequired', AUTH_PASSWORD_INVALID: 'auth.passwordInvalid',
    RATE_LIMITED: 'auth.rateLimited', NETWORK_ERROR: 'login.serverUnreachable',
};
export const authErrorKey = error => keys[error?.code] || 'auth.failed';
