import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../utils/api.js';
import { authErrorKey } from '../utils/authErrors.js';
import { formatTs } from '../utils/format.js';

export default function Accounts({ currentUser, onUnauth }) {
    const { t } = useTranslation();
    const [users, setUsers] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [errorKey, setErrorKey] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        try {
            const [accounts, active] = await Promise.all([apiFetch('/accounts', {}, onUnauth), apiFetch('/auth/sessions', {}, onUnauth)]);
            setUsers(accounts); setSessions(active);
        } catch (error) { setErrorKey(authErrorKey(error)); }
    }, [onUnauth]);
    useEffect(() => { void load(); }, [load]);
    const perform = async work => {
        if (busy) return;
        setBusy(true); setErrorKey(null);
        try { if (await work() !== false) await load(); }
        catch (error) { setErrorKey(authErrorKey(error)); }
        finally { setBusy(false); }
    };
    const create = event => {
        event.preventDefault();
        void perform(async () => {
            await apiFetch('/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }, onUnauth);
            setUsername(''); setPassword('');
        });
    };
    const changePassword = event => {
        event.preventDefault();
        void perform(async () => {
            await apiFetch('/auth/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, password: newPassword }) }, onUnauth);
            setCurrentPassword(''); setNewPassword(''); onUnauth(); return false;
        });
    };
    const enable = user => perform(async () => {
        await apiFetch('/accounts/' + user.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !user.enabled }) }, onUnauth);
        if (user.id === currentUser.id) { onUnauth(); return false; }
    });
    const revoke = session => perform(async () => {
        await apiFetch('/auth/sessions/' + session.id, { method: 'DELETE' }, onUnauth);
        if (session.current) { onUnauth(); return false; }
    });
    const enabled = users.filter(user => user.enabled).length;
    return <div>
        <h2>{t('auth.accountsTitle')}</h2>
        <p>{t('auth.adminAuthority')}</p>
        {errorKey && <div className="login-error" role="alert">{t(errorKey)}</div>}
        <table className="routes-table"><thead><tr><th>{t('login.username')}</th><th>{t('auth.accountState')}</th><th>{t('auth.actions')}</th></tr></thead>
            <tbody>{users.map(user => <tr key={user.id}><td>{user.username}</td><td>{t(user.enabled ? 'auth.enabled' : 'auth.disabled')}</td>
                <td><button className="btn" disabled={busy || (user.enabled && enabled === 1)} onClick={() => enable(user)}>{t(user.enabled ? 'auth.disableAccount' : 'auth.enableAccount')}</button></td></tr>)}</tbody></table>
        <form onSubmit={create}>
            <h3>{t('auth.createAdmin')}</h3>
            <div className="field"><label htmlFor="account-user">{t('login.username')}</label><input id="account-user" value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" maxLength={64} required /></div>
            <div className="field"><label htmlFor="account-password">{t('auth.newPassword')}</label><input id="account-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={1024} required /></div>
            <button className="btn btn-primary" disabled={busy}>{t('auth.createAdmin')}</button>
        </form>
        <form onSubmit={changePassword}>
            <h3>{t('auth.changePassword')}</h3>
            <div className="field"><label htmlFor="current-password">{t('auth.currentPassword')}</label><input id="current-password" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></div>
            <div className="field"><label htmlFor="new-password">{t('auth.newPassword')}</label><input id="new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={1024} required /></div>
            <button className="btn btn-primary" disabled={busy}>{t('auth.changePassword')}</button>
        </form>
        <h3>{t('auth.sessionsTitle')}</h3>
        <table className="routes-table"><thead><tr><th>{t('auth.session')}</th><th>{t('auth.created')}</th><th>{t('auth.expires')}</th><th>{t('auth.actions')}</th></tr></thead>
            <tbody>{sessions.map(session => <tr key={session.id}><td>{t(session.current ? 'auth.currentSession' : 'auth.otherSession')}</td>
                <td>{formatTs(new Date(session.createdAt).toISOString())}</td><td>{formatTs(new Date(session.expiresAt).toISOString())}</td>
                <td><button className="btn" disabled={busy} onClick={() => revoke(session)}>{t('auth.revoke')}</button></td></tr>)}</tbody></table>
    </div>;
}
