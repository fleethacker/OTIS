// Verify the retained final scenario after duplicate intake and a backend restart.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.PRIORITY_2_BASE_URL || 'http://127.0.0.1:18422';
const output = process.env.PRIORITY_2_OUTPUT || '/private/tmp/priority-2-browser';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback origin required');
(async () => {
  const before = JSON.parse(await fs.readFile(path.join(output, 'results.json'), 'utf8')).final;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await page.goto(base + '/__ark/mock-login?return=/assigned-work');
      if (response.ok()) break;
      await page.waitForTimeout(1000);
    }
    await page.getByLabel('Demo account').selectOption('viewer');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/__ark/') && !url.pathname.startsWith('/auth/'));
    async function call(op, data = {}) {
      const response = await page.context().request.post(base + '/api/v1/' + op, { data, headers: { Origin: base } });
      assert.equal(response.status(), 200); return response.json();
    }
    const after = await call('anchor/current');
    assert.deepEqual(after, before);
    const work = await call('work/list');
    assert.equal(work.items.length, 3);
    const task = work.items.find(item => item.logicalEventId === 'meridian-2026-11-10:original');
    assert.equal(task.instructionStatus, 'cancelled');
    assert.equal(task.reviews.length, 3); assert.equal(task.reviewed, true);
    assert.equal(task.remindersActive, false); assert.equal(task.overdue, false);
    const timeline = await call('messages/timeline', { from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z' });
    assert.equal(timeline.meta.timelineItems.some(item => item.logicalEventId === task.logicalEventId), false);
    await page.goto(base + '/calendar?date=2026-11-10&view=day');
    await page.getByRole('heading', { name: 'Event cancelled', exact: true }).waitFor();
    const result = { passed: true, checks: ['Identical persisted current view/token/reviews after restart', 'Three tasks; cancellation reviewed; reminders inactive', 'No resurrected selected event after duplicate source intake'] };
    await fs.writeFile(path.join(output, 'persistence-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
