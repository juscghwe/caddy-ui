import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../utils/api.js";
import { authErrorKey } from '../utils/authErrors.js';

export default function Login({ onLogin, sessionExpired }) {
    const { t } = useTranslation();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(sessionExpired ? t("login.sessionExpired") : "");
    const [loading, setLoading] = useState(false);

    const login = async () => {
        if (loading || !username || !password) return;
        setLoading(true);
        setError("");
        try {
            await apiFetch('/auth/sessions', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            setPassword('');
            await onLogin();
        } catch (error) {
            setError(t(authErrorKey(error)));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-shell">
            <div className="login-card">
                <div className="login-logo">caddy/ui</div>
                <div className="login-sub">{t("login.serverManager")}</div>
                {error && <div className="login-error">{error}</div>}
                <div className="field">
                    <label htmlFor="login-user">{t("login.username")}</label>
                    <input id="login-user" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} autoFocus autoComplete="username" />
                </div>
                <div className="field">
                    <label htmlFor="login-password">{t("login.password")}</label>
                    <input id="login-password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} autoComplete="current-password" />
                </div>
                <button className="btn btn-primary btn--full" onClick={login} disabled={loading || !username || !password}>
                    {loading ? t("login.signingIn") : t("login.signIn")}
                </button>
            </div>
        </div>
    );
}
