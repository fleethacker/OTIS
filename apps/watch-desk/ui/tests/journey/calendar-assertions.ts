import { expect, type Page } from "@playwright/test";

export function calendarEvent(page: Page, title: string, view = ".rbc-time-view") {
  const calendar = page.locator(view);
  return calendar.getByRole("link", { name: `${title}, source record`, exact: true }).or(
    calendar.getByRole("button", { name: `${title}, event details`, exact: true })
  );
}

export async function expectCalendarSections(page: Page) {
  const calendar = page.locator(".timeline-section");
  const upcoming = page.getByRole("region", { name: "Next upcoming events", exact: true });
  const review = page.getByRole("region", { name: "Needs review", exact: true });
  await expect(calendar).toBeVisible();
  await expect(upcoming).toBeVisible();
  await expect(review).toHaveCount(0);
  await expect(calendar.locator("+ section")).toHaveAttribute("aria-labelledby", "upcoming-heading");
  await expect(page.getByRole("region", { name: "Exact event details", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Exact event details/ })).toHaveCount(0);
  await expect(page.locator(".calendar-details, [data-testid^='event-']")).toHaveCount(0);
  await expect(page.getByText(/details (?:remain )?below the calendar/)).toHaveCount(0);
}

export async function expectDayGeometry(page: Page, title: string, top: number, height: number) {
  const event = page.locator(".rbc-time-content .rbc-event").filter({
    has: page.getByRole("link", { name: `${title}, source record`, exact: true }),
  });
  await expect(event).toHaveCount(1);
  // Measure against the full day column, not its scroll viewport.
  await expect.poll(async () => event.evaluate((element, expectedTop) => {
    const column = element.closest(".rbc-day-slot")!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return Math.abs((box.top - column.top) / column.height - expectedTop);
  }, top)).toBeLessThan(0.003);
  await expect.poll(async () => event.evaluate((element, expectedHeight) => {
    const column = element.closest(".rbc-day-slot")!.getBoundingClientRect();
    return Math.abs(element.getBoundingClientRect().height / column.height - expectedHeight);
  }, height)).toBeLessThan(0.003);
}

export async function expectMonthGrid(page: Page, year: number, month: number, days: number) {
  const grid = page.locator(".rbc-month-view");
  await expect(grid).toBeVisible();
  await expect(grid.locator(".rbc-header")).toHaveCount(7);
  const rows = grid.locator(".rbc-month-row");
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  expect(await rows.count()).toBeLessThanOrEqual(6);
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    await expect(grid.getByRole("button", { name: `Open ${date} in Day view`, exact: true })).toHaveCount(1);
  }
  for (const row of await rows.all()) {
    await expect(row.locator(".rbc-date-cell")).toHaveCount(7);
  }
}
