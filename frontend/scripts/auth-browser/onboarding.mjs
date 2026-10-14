import test from 'node:test';
import assert from 'node:assert/strict';
import { authConfig } from '../../../backend/src/auth/config.js';
import { resetPassword } from '../../../backend/src/auth/maintenance.js';
import { fixture, signIn, signOut, saveRecovery, password } from './fixture.mjs';

test('existing HTTPS: one-time bootstrap, accounts, revocation and no credential storage', { timeout: 120_000 }, async () => {
    await fixture(false, async ({ page, context, origin, plainOrigin, code, env, start, stop }) => {
        await page.goto(plainOrigin); await page.getByRole('heading', { name: 'Configure HTTPS before signing in' }).waitFor();
        assert.equal(await page.locator('input[type=password]').count(), 0);
        await page.goto(origin); await page.getByRole('heading', { name: 'Create the first administrator' }).waitFor();
        await page.getByLabel('One-time setup code').fill(code); await page.getByLabel('Username', { exact: true }).fill('admin');
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Create administrator', exact: true }).click();
        const recovery = await saveRecovery(page); await signIn(page, 'admin');
        const cookie = (await context.cookies()).find(value => value.name === '__Host-caddy_ui_session');
        assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
        assert.equal(await page.evaluate(() => localStorage.getItem('caddy_ui_token')), null);
        assert(!page.url().includes(cookie.value)); assert(!page.url().includes(recovery));
        assert(!await page.evaluate(() => globalThis.document.cookie.includes('__Host-caddy_ui_session')));
        await page.locator('.nav-item').filter({ hasText: 'Accounts' }).click();
        await page.getByRole('heading', { name: 'Administrator accounts' }).waitFor();
        assert(await page.getByRole('button', { name: 'Disable account', exact: true }).isDisabled());
        await page.locator('#account-user').fill('other'); await page.locator('#account-password').fill(password);
        await page.getByRole('button', { name: 'Create administrator', exact: true }).click();
        const row = page.locator('tr').filter({ hasText: 'other' }); await row.waitFor();
        await row.getByRole('button', { name: 'Disable account' }).click(); await row.getByRole('button', { name: 'Enable account' }).waitFor();
        await row.getByRole('button', { name: 'Enable account' }).click(); await row.getByRole('button', { name: 'Disable account' }).waitFor();
        // Server-side revocation must work across a real restart and browser reload.
        await stop(); await resetPassword(authConfig(env), 'admin', 'replacement long password'); await start();
        await page.reload(); await page.locator('#login-user').waitFor();
        await signIn(page, 'admin', 'replacement long password');
        await page.locator('.nav-item').filter({ hasText: 'Accounts' }).click();
        await page.locator('#current-password').fill('replacement long password'); await page.locator('#new-password').fill('another replacement password');
        await page.getByRole('button', { name: 'Change my password' }).click(); await page.locator('#login-user').waitFor();
        await signIn(page, 'admin', 'another replacement password'); await signOut(page);
        assert(!(await context.cookies()).some(value => value.name === '__Host-caddy_ui_session'));
        await page.reload(); await page.locator('#login-user').waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Save your database recovery code' }).count(), 0);
    });
});
