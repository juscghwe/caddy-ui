/* eslint-disable i18next/no-literal-string -- API identifiers, codes and serialization are protocol data */
export const API = '/api';
let csrfToken = null;
let authEnabled = null;

export class ApiError extends Error {
    constructor(message, { code = 'REQUEST_FAILED', status = null, requestId = null } = {}) {
        super(message);
        Object.assign(this, { name: 'ApiError', code, status, requestId });
    }
}
export function clearSession() { csrfToken = null; }
function clearLegacyAuth() {
    try { localStorage.removeItem('caddy_ui_token'); localStorage.removeItem('caddy_ui_auth_enabled'); } catch { /* Storage is optional for authentication. */ }
}
export async function fetchAuthState() {
    clearLegacyAuth();
    const state = await apiFetch('/auth/status');
    if (typeof state?.authEnabled !== 'boolean' || typeof state.initialized !== 'boolean' || typeof state.secure !== 'boolean') {
        throw new ApiError('Invalid auth state', { code: 'CLIENT_PARSE_FAILED' });
    }
    if (state.user && (typeof state.user.id !== 'string' || typeof state.user.username !== 'string' || state.user.role !== 'administrator' || !state.user.enabled || typeof state.csrfToken !== 'string')) {
        throw new ApiError('Invalid session state', { code: 'CLIENT_PARSE_FAILED' });
    }
    authEnabled = state.authEnabled;
    csrfToken = state.csrfToken || null;
    return state;
}
export function getInstanceId() { try { return localStorage.getItem('caddy_ui_instance') || 'default'; } catch { return 'default'; } }
export function setInstanceId(id) { try { localStorage.setItem('caddy_ui_instance', id); } catch { /* Optional UI cache. */ } }
export const fetchSettings = onUnauth => apiFetch('/settings', {}, onUnauth);
export const fetchCustomThemes = onUnauth => apiFetch('/custom-themes', {}, onUnauth);
export const saveSettings = (updates, onUnauth) => apiFetch('/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
}, onUnauth);

export async function apiFetch(path, opts = {}, onUnauth) {
    clearLegacyAuth();
    const method = opts.method || 'GET';
    const headers = { ...opts.headers, 'X-Instance-Id': getInstanceId() };
    const publicMutation = method === 'POST' && ['/auth/sessions', '/auth/bootstrap'].includes(path);
    if (!['GET', 'HEAD'].includes(method) && !publicMutation) {
        if (!csrfToken && authEnabled !== false) await fetchAuthState();
        if (authEnabled && !csrfToken) {
            onUnauth?.();
            throw new ApiError('Session expired', { code: 'UNAUTHORIZED', status: 401 });
        }
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }
    let res;
    try { res = await fetch(API + path, { ...opts, method, headers, credentials: 'same-origin', cache: 'no-store' }); }
    catch { throw new ApiError('Connection failed', { code: 'NETWORK_ERROR' }); }
    let body;
    try { body = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text(); }
    catch { throw new ApiError('Invalid server response', { code: 'CLIENT_PARSE_FAILED', status: res.status }); }
    if (!res.ok) {
        if (res.status === 401 && !publicMutation) { clearSession(); onUnauth?.(); }
        throw new ApiError(body?.errors?.join('\n') || body?.error || res.statusText, {
            code: body?.code || (res.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED'), status: res.status,
            requestId: body?.requestId || res.headers.get('X-Request-ID'),
        });
    }
    if (method === 'POST' && path === '/auth/sessions') { csrfToken = body.csrfToken; authEnabled = true; }
    return body;
}

export async function downloadText(path, filename, onUnauth, type = 'text/plain') {
    const text = await apiFetch(path, {}, onUnauth);
    if (typeof text !== 'string') throw new ApiError('Invalid download response', { code: 'CLIENT_PARSE_FAILED' });
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
