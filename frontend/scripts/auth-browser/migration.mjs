import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, openPage, signIn, signOut, saveRecovery } from './fixture.mjs';

test('legacy migration activates once over existing HTTPS and retains imported credentials', { timeout: 120_000 }, async () => {
    await fixture(true, async ({ page, origin, code }) => {
        await openPage(page, origin); await page.getByRole('heading', { name: 'Activate your imported administrator' }).waitFor();
        assert.equal(await page.locator('input[type=password]').count(), 0);
        await page.getByLabel('One-time setup code').fill(code); await page.getByRole('button', { name: 'Activate administrator' }).click();
        await saveRecovery(page); await signIn(page, 'legacy'); await signOut(page);
        await page.reload(); await page.locator('#login-user').waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Activate your imported administrator' }).count(), 0);
    });
});

