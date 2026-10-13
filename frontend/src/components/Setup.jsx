import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../utils/api.js';
import { authErrorKey } from '../utils/authErrors.js';

export default function Setup({ state, onComplete }) {
    const { t } = useTranslation();
    const [code, setCode] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorKey, setErrorKey] = useState(null);
    const [loading, setLoading] = useState(false);
    const [recovery, setRecovery] = useState(null);
    const [saved, setSaved] = useState(false);
    const downloadUrl = useRef(null);
    useEffect(() => () => { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
    const claim = async event => {
        event.preventDefault();
        if (loading) return;
        setLoading(true); setErrorKey(null);
        try {
            const result = await apiFetch('/auth/bootstrap', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, username, password }),
            });
            setCode(''); setPassword(''); setRecovery(result);
        } catch (error) { setErrorKey(authErrorKey(error)); }
        finally { setLoading(false); }
    };
    const exportRecovery = () => {
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
        downloadUrl.current = URL.createObjectURL(new Blob([JSON.stringify({
            version: 1, installationId: recovery.installationId,
            origin: state.externalUrl, recoveryCode: recovery.recoveryCode,
        }, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = downloadUrl.current;
        // eslint-disable-next-line i18next/no-literal-string -- Stable recovery-export filename
        anchor.download = 'caddy-ui-recovery.json';
        anchor.click();
    };
    const finish = () => { setRecovery(null); onComplete(); };
    return <div className="login-shell"><div className="login-card">
        <div className="login-logo">caddy/ui</div>
        {state.unavailable ? <>
            <p>{t('login.serverUnreachable')}</p>
            <button className="btn btn-primary" onClick={onComplete}>{t('auth.retry')}</button>
        </> : !state.secure ? <>
            <h2>{t('auth.httpsTitle')}</h2>
            <p>{t('auth.httpsRequired')}</p>
            <p>{t('auth.httpsGuide')}</p>
            {state.externalUrl && <a href={state.externalUrl}>{t('auth.openHttps')}</a>}
            <button className="btn" onClick={onComplete}>{t('auth.retry')}</button>
        </> : recovery ? <>
            <h2>{t('auth.recoveryTitle')}</h2>
            <p>{t('auth.recoveryGuide')}</p>
            <textarea aria-label={t('auth.recoveryCode')} value={recovery.recoveryCode} readOnly autoComplete="off" />
            <button className="btn btn-primary" onClick={exportRecovery}>{t('auth.downloadRecovery')}</button>
            <label><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />{t('auth.savedRecovery')}</label>
            <button className="btn" disabled={!saved} onClick={finish}>{t('auth.continueLogin')}</button>
        </> : <form onSubmit={claim}>
            <h2>{t('auth.setupTitle')}</h2>
            <p>{t('auth.setupGuide')}</p>
            {errorKey && <div className="login-error" role="alert">{t(errorKey)}</div>}
            <div className="field"><label htmlFor="setup-code">{t('auth.setupCode')}</label>
                <input id="setup-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" required /></div>
            <div className="field"><label htmlFor="setup-user">{t('login.username')}</label>
                <input id="setup-user" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" maxLength={64} required /></div>
            <div className="field"><label htmlFor="setup-password">{t('login.password')}</label>
                <input id="setup-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={1024} required /></div>
            <p>{t('auth.passwordGuide')}</p>
            <button className="btn btn-primary" disabled={loading}>{t(loading ? 'auth.creating' : 'auth.createAdmin')}</button>
        </form>}
    </div></div>;
}
