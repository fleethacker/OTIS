// Real-browser acceptance against a fresh isolated Rust/OpenSearch scenario.
// Uses the prepared Playwright installation; never mocks application responses.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.PRIORITY_1_BASE_URL || 'http://127.0.0.1:18420';
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.pathname !== '/') throw Error('Explicit isolated loopback origin required');
const output = process.env.PRIORITY_1_OUTPUT || '/private/tmp/priority-1-browser';
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks = [];
  const errors = [];
  async function account(role) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/__ark/mock-login?return=/assigned-work');
    await page.getByLabel('Demo account').selectOption(role);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/__ark/') && !url.pathname.startsWith('/auth/'));
    await page.goto(base + '/assigned-work');
    await page.getByRole('heading', { name: 'Assigned work', exact: true }).waitFor();
    return { context, page };
  }
  try {
    const admin = await account('admin');
    const setup = admin.page.getByRole('button', { name: 'Set up Meridian scenario' });
    await setup.waitFor({ timeout: 15000 });
    await setup.click();
    const original = admin.page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true });
    await original.waitFor();
    assert.equal(await admin.page.getByRole('article').count(), 3);
    assert.equal(await admin.page.getByText('Due time unknown', { exact: true }).count(), 1);
    checks.push('Three real source-derived tasks; unrelated source creates no task; unknown deadline visible');
    await admin.page.getByRole('button', { name: 'Set scenario clock to 09:01 UTC' }).click();
    await original.getByText('Overdue review', { exact: true }).waitFor();
    checks.push('Scenario clock advances and original review becomes overdue');
    const viewer = await account('viewer');
    const owned = viewer.page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true });
    await owned.getByRole('button', { name: 'Reviewed this version' }).click();
    await owned.getByText('Version reviewed', { exact: true }).waitFor();
    assert.equal(await owned.locator('span').filter({ hasText: /^Not started$/ }).count(), 1);
    assert.equal(await owned.getByText('Overdue review', { exact: true }).count(), 0);
    await viewer.page.reload();
    await viewer.page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true }).getByText('Version reviewed', { exact: true }).waitFor();
    checks.push('Designated owner review persists on reload without starting or completing work');
    await viewer.page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true }).getByRole('link', { name: 'Open exact source · a1' }).click();
    await viewer.page.getByText('Fictional Meridian original', { exact: false }).first().waitFor();
    assert.ok(new URL(viewer.page.url()).searchParams.get('record').startsWith('sha256:'));
    checks.push('Exact canonical source opens in existing message reader');
    await admin.page.reload();
    const engineering = admin.page.getByRole('article', { name: 'Review and coordinate MERIDIAN ENGINEERING', exact: true });
    await engineering.getByLabel('Decision reason').fill('Assign synthetic relief coordination');
    await engineering.getByLabel('Local owner').selectOption('demo:dev-user');
    await engineering.getByRole('button', { name: 'Reassign', exact: true }).click();
    await engineering.getByText('Meridian · Engineering · dev-user · P-01', { exact: true }).waitFor();
    await admin.page.reload();
    await admin.page.getByRole('article', { name: 'Review and coordinate MERIDIAN ENGINEERING', exact: true }).getByText('Meridian · Engineering · dev-user · P-01', { exact: true }).waitFor();
    checks.push('Coordinator reassignment is visible and persists on reload');
    await viewer.page.goto(base + '/assigned-work');
    const active = viewer.page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true });
    await active.getByLabel('Decision reason').fill('Synthetic coordination started');
    await active.getByLabel('Task progress').selectOption('in_progress');
    await active.getByRole('button', { name: 'Save progress' }).click();
    await active.locator('span').filter({ hasText: /^In progress$/ }).waitFor();
    await viewer.page.reload();
    await viewer.page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true }).locator('span').filter({ hasText: /^In progress$/ }).waitFor();
    checks.push('Progress mutation persists independently of review');
    await viewer.page.screenshot({ path: path.join(output, 'assigned-work.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: checks, browserErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: checks, browserErrors: errors }, null, 2));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, `failure-${browser.contexts().indexOf(context)}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
