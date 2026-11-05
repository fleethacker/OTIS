// Real Calendar acceptance against isolated Rust/OpenSearch state prepared with
// replay_priority3.py --stage conflict. No mocks or page-evaluated API requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = (process.env.PRIORITY_3_BASE_URL || 'http://127.0.0.1:18430').replace(/\/$/, '');
const origin = new URL(base);
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
  throw Error('Explicit isolated loopback HTTP origin required');
const output = process.env.PRIORITY_3_OUTPUT || '/private/tmp/priority-3-browser';
const config = process.env.PRIORITY_3_CONFIG_ROOT || path.resolve(__dirname, '../backend/config');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(config, 'priority-2/sources.json'), 'utf8'));
  const expectedSource = manifest.find(row => row.name === 'amendment').sourceKey;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  const started = Date.now();
  page.on('pageerror', error => errors.push(error.message));
  const panel = page.getByRole('region', { name: 'Personnel planning', exact: true });
  const training = panel.getByRole('article', { name: /^Local training/ });
  const fixed = panel.getByRole('article', { name: /^Communications window/ });
  const localBlock = page.locator('[data-calendar-event^="local-plan#"]');
  const record = message => checks.push({ message, elapsedSeconds: (Date.now() - started) / 1000 });
  async function localInterval(start, end) {
    await localBlock.waitFor({ state: 'visible' });
    assert.equal(await localBlock.count(), 1);
    const title = await localBlock.getAttribute('title');
    assert.match(title, /Local training plan — separately authored/);
    assert.match(title, new RegExp('Start:.*' + start));
    assert.match(title, new RegExp('End:.*' + end));
  }
  async function fixedUnchanged() {
    await fixed.getByText('2026-11-10 10:30–11:15 UTC', { exact: true }).waitFor();
    const href = await fixed.getByRole('link', { name: /^View source:/ }).getAttribute('href');
    const url = new URL(href, base);
    assert.equal(url.searchParams.get('record'), expectedSource);
    assert.ok(url.searchParams.get('returnTo').startsWith('/calendar?'));
    return href;
  }
  try {
    await page.goto(base + '/__ark/mock-login?return=/calendar');
    await page.getByLabel('Demo account').selectOption('admin');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/__ark/') && !url.pathname.startsWith('/auth/'));
    await page.goto(base + '/calendar?date=2026-11-10&view=day');
    await panel.waitFor({ timeout: 15000 });
    await panel.getByText('Personnel conflict: P-01', { exact: true }).waitFor();
    await panel.getByText('Overlap: 2026-11-10 10:45–11:15 UTC', { exact: true }).waitFor();
    await panel.getByText('Earliest feasible alternative: 2026-11-10 11:15–11:45 UTC', { exact: true }).waitFor();
    await panel.getByText(/Provisional assessment/).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Accept local training move', exact: true }).count(), 0);
    const sourceHref = await fixedUnchanged();
    await localInterval('10:45', '11:15');
    assert.match(await localBlock.getAttribute('href'), /#personnel-planning-heading$/);
    record('Rendered Calendar explains P-01 collision, provisional inputs, earliest slot, and exact amended source');
    await page.screenshot({ path: path.join(output, 'calendar-conflict.png'), fullPage: true });

    await panel.getByRole('button', { name: 'Calculate and save proposal', exact: true }).click();
    await panel.getByLabel('Decision reason (optional)').fill('Synthetic browser check: reject first alternative');
    await panel.getByRole('button', { name: 'Reject proposal', exact: true }).click();
    await panel.getByText(/^Rejected proposal ·/).waitFor();
    await training.getByText('2026-11-10 10:45–11:15 UTC', { exact: true }).waitFor();
    assert.equal(await fixedUnchanged(), sourceHref);
    await page.reload();
    await panel.getByText(/^Rejected proposal ·/).waitFor();
    await training.getByText('2026-11-10 10:45–11:15 UTC', { exact: true }).waitFor();
    await panel.getByText('Personnel conflict: P-01', { exact: true }).waitFor();
    await localInterval('10:45', '11:15');
    record('Rejection and actor history persist across reload; training stays 10:45–11:15 and fixed source is unchanged');
    await page.screenshot({ path: path.join(output, 'calendar-rejected.png'), fullPage: true });

    await panel.getByRole('button', { name: 'Calculate and save proposal', exact: true }).click();
    await panel.getByLabel('Decision reason (optional)').fill('Synthetic browser check: preserve fixed source window');
    await panel.getByRole('button', { name: 'Accept local training move', exact: true }).click();
    await panel.getByText(/^Accepted local training move ·/).waitFor();
    await training.getByText('2026-11-10 11:15–11:45 UTC', { exact: true }).waitFor();
    assert.equal(await fixedUnchanged(), sourceHref);
    await page.reload();
    await training.getByText('2026-11-10 11:15–11:45 UTC', { exact: true }).waitFor();
    await panel.getByText(/^Accepted local training move ·/).waitFor();
    await panel.getByText(/^Rejected proposal ·/).waitFor();
    assert.equal(await panel.getByText('Personnel conflict: P-01', { exact: true }).count(), 0);
    assert.equal(await fixedUnchanged(), sourceHref);
    await localInterval('11:15', '11:45');
    record('Acceptance changes only local training to 11:15–11:45; reload retains both decisions, fixed 10:30 source and exact evidence link');
    await page.screenshot({ path: path.join(output, 'calendar-accepted.png'), fullPage: true });

    for (const view of ['week', 'month']) {
      await page.goto(base + '/calendar?date=2026-11-10&view=' + view);
      await localInterval('11:15', '11:45');
      await page.screenshot({ path: path.join(output, 'calendar-accepted-' + view + '.png'), fullPage: true });
    }
    record('Accepted training is a real calendar block in day, week and month views');
    await page.goto(base + '/calendar?date=2026-11-11&view=day');
    await page.getByRole('button', { name: 'Refresh calendar', exact: true }).and(page.locator(':not(:disabled)')).waitFor();
    assert.equal(await localBlock.count(), 0);
    assert.equal(await panel.count(), 0);
    const otherShips = encodeURIComponent(JSON.stringify(['unit:other-command']));
    await page.goto(base + '/calendar?date=2026-11-10&view=day&ships=' + otherShips);
    await page.getByRole('button', { name: 'Refresh calendar', exact: true }).and(page.locator(':not(:disabled)')).waitFor();
    assert.equal(await localBlock.count(), 0);
    assert.equal(await panel.count(), 0);
    const meridian = encodeURIComponent(JSON.stringify(['unit:demo-meridian']));
    await page.goto(base + '/calendar?date=2026-11-10&view=day&ships=' + meridian);
    await localInterval('11:15', '11:45');
    await panel.waitFor();
    record('Local plan and planning controls respect selected date and command');
    assert.deepEqual(errors, []);
    const result = { passed: true, checks, browserErrors: errors, elapsedSeconds: (Date.now() - started) / 1000 };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: false, checks, browserErrors: errors, error: error.message }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
