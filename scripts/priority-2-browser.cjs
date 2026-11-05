// Real Chrome acceptance against fresh isolated Rust/OpenSearch state; no request mocks.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.PRIORITY_2_BASE_URL || 'http://127.0.0.1:18422';
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.pathname !== '/') throw Error('Explicit isolated loopback origin required');
const output = process.env.PRIORITY_2_OUTPUT || '/private/tmp/priority-2-browser';
const eventId = 'meridian-2026-11-10:original';
const provenance = 'Explicit whole-event relationship in the authored priority-2 synthetic scenario; no amendment-language inference';
(async () => {
  await fs.mkdir(output, { recursive: true });
  const bindings = JSON.parse(await fs.readFile(path.join(__dirname, '../backend/config/priority-2/sources.json'), 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks = [], errors = [];
  async function account(role) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await page.goto(base + '/__ark/mock-login?return=/assigned-work');
      if (response.ok()) { ready = true; break; }
      await page.waitForTimeout(1000);
    }
    assert.ok(ready, 'The actual isolated backend must finish startup');
    await page.getByLabel('Demo account').selectOption(role);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/__ark/') && !url.pathname.startsWith('/auth/'));
    return { context, page };
  }
  async function call(account, operation, body = {}, status = 200) {
    const response = await account.context.request.post(base + '/api/v1/' + operation, { data: body, headers: { Origin: base } });
    const value = await response.json();
    assert.equal(response.status(), status, operation + ': ' + JSON.stringify(value));
    return value;
  }
  const history = page => page.getByRole('article', { name: 'Event history ' + eventId, exact: true });
  const task = page => page.getByRole('article', { name: 'Review and coordinate MERIDIAN COMMS', exact: true });
  async function timeline(account) {
    return call(account, 'messages/timeline', { from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z', dataset: 'canonical' });
  }
  try {
    const admin = await account('admin');
    await admin.page.goto(base + '/assigned-work');
    await admin.page.getByRole('button', { name: 'Set up Meridian scenario' }).click();
    await task(admin.page).waitFor();
    let work = await call(admin, 'work/list');
    assert.equal(work.items.length, 3);
    await call(admin, 'anchor/setup', { expectedVersion: work.version });
    const viewer = await account('viewer');
    await viewer.page.goto(base + '/assigned-work');
    await task(viewer.page).getByRole('button', { name: 'Reviewed this version', exact: true }).click();
    await task(viewer.page).getByText('Version reviewed', { exact: true }).waitFor();
    let current = await call(admin, 'anchor/current');
    const original = current.items[0];
    assert.equal(new Date(original.current.interval.start).toISOString(), '2026-11-10T09:00:00.000Z');
    const amendment = bindings.find(row => row.name === 'amendment');
    const declaration = { expectedVersion: current.version, logicalEventId: eventId, versionId: 'amendment', source: { messageKey: amendment.sourceKey, factId: amendment.factId }, relationship: { kind: 'amends', target: 'original' }, effectiveAt: '2026-11-10T08:30:00Z', provenance };
    await call(admin, 'anchor/declare', declaration);
    current = await call(admin, 'anchor/current');
    assert.equal(current.items[0].versionToken, original.versionToken);
    assert.equal(current.items[0].reviewed, true);
    await viewer.page.reload();
    await history(viewer.page).getByText(/Next declared change takes effect/).waitFor();
    checks.push('Original review remains valid while amendment is future effective');
    await call(admin, 'work/clock', { expectedVersion: current.version, scenarioNow: '2026-11-10T08:45:00Z' });
    await call(viewer, 'work/review', { taskId: original.taskId, expectedVersion: original.taskVersion, eventVersion: original.eventVersion, currentVersionToken: original.versionToken }, 409);
    await viewer.page.reload();
    await history(viewer.page).getByText(/Time changed:.*09:00–09:45.*10:30–11:15/).waitFor();
    assert.equal(await task(viewer.page).getByText('Version reviewed', { exact: true }).count(), 0);
    assert.equal(await task(viewer.page).locator('span').filter({ hasText: /^Not started$/ }).count(), 1);
    checks.push('Amendment changes only current version, reopens review and rejects stale original submission');
    let calendar = await timeline(viewer);
    const active = calendar.meta.timelineItems.filter(row => row.logicalEventId === eventId);
    assert.equal(active.length, 1);
    assert.equal(new Date(active[0].start).toISOString(), '2026-11-10T10:30:00.000Z');
    assert.ok(calendar.meta.timelineItems.some(row => row.messageKey === amendment.sourceKey && row.factId === 'a2'));
    await viewer.page.goto(base + '/calendar?date=2026-11-10&view=day');
    await history(viewer.page).getByText(/Time changed:/).waitFor();
    await viewer.page.screenshot({ path: path.join(output, 'amended-calendar.png'), fullPage: true });
    checks.push('Calendar shows one amended selected event and retains unrelated a2 from the same message');
    await history(viewer.page).getByText('Sources and review history', { exact: true }).click();
    await history(viewer.page).getByRole('link', { name: 'Amendment source', exact: true }).click();
    await history(viewer.page).getByRole('button', { name: 'Reviewed this version', exact: true }).click();
    await history(viewer.page).getByText('Reviewed this version', { exact: true }).waitFor();
    await viewer.page.getByRole('tab', { name: 'Raw message', exact: true }).click();
    await viewer.page.getByRole('region', { name: 'Raw message', exact: true }).getByText(/COMPLAN\/MERIDIAN COMMS/).waitFor();
    await viewer.page.screenshot({ path: path.join(output, 'amended-reader.png'), fullPage: true });
    await viewer.page.goto(base + '/assigned-work');
    await task(viewer.page).getByText('Version reviewed', { exact: true }).waitFor();
    checks.push('Reader opens immutable amended evidence and records review visible in the task queue');
    current = await call(admin, 'anchor/current');
    const cancellation = bindings.find(row => row.name === 'cancellation');
    await call(admin, 'anchor/declare', { expectedVersion: current.version, logicalEventId: eventId, versionId: 'cancellation', source: { messageKey: cancellation.sourceKey, factId: null }, relationship: { kind: 'cancels', target: 'amendment' }, effectiveAt: '2026-11-10T09:30:00Z', provenance });
    current = await call(admin, 'anchor/current');
    await call(admin, 'work/clock', { expectedVersion: current.version, scenarioNow: '2026-11-10T09:30:00Z' });
    const duplicate = await call(admin, 'anchor/declare', declaration);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.item.status, 'cancelled');
    await call(admin, 'work/clock', { expectedVersion: duplicate.version, scenarioNow: '2026-11-10T08:15:00Z' }, 400);
    calendar = await timeline(viewer);
    assert.equal(calendar.meta.timelineItems.filter(row => row.logicalEventId === eventId).length, 0);
    assert.ok(calendar.meta.timelineItems.some(row => row.messageKey === amendment.sourceKey && row.factId === 'a2'));
    work = await call(viewer, 'work/list');
    const cancelled = work.items.find(row => row.logicalEventId === eventId);
    assert.equal(work.items.length, 3);
    assert.equal(cancelled.dueAt, null);
    assert.equal(cancelled.overdue, false);
    assert.equal(cancelled.reviewed, false);
    assert.equal(cancelled.reviews.length, 2);
    await viewer.page.goto(base + '/calendar?date=2026-11-10&view=day');
    await history(viewer.page).getByRole('heading', { name: 'Event cancelled', exact: true }).waitFor();
    await history(viewer.page).getByRole('button', { name: 'Reviewed this version', exact: true }).click();
    await history(viewer.page).getByText('Reviewed this version', { exact: true }).waitFor();
    await viewer.page.reload();
    await history(viewer.page).getByText('Reviewed this version', { exact: true }).waitFor();
    await history(viewer.page).getByText('Sources and review history', { exact: true }).click();
    assert.equal(await history(viewer.page).getByText('Earlier version', { exact: false }).count(), 2);
    await viewer.page.screenshot({ path: path.join(output, 'cancelled-calendar.png'), fullPage: true });
    checks.push('Cancellation removes scheduling/reminders, keeps three tasks and prior reviews, and accepts its own review');
    checks.push('Duplicate amendment cannot resurrect cancellation; backwards scenario clock is rejected; review persists on reload');
    assert.deepEqual(errors, []);
    const result = { passed: checks, browserErrors: errors, final: await call(viewer, 'anchor/current') };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: checks, browserErrors: errors }, null, 2));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, `failure-${browser.contexts().indexOf(context)}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
