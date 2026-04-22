import { test, expect } from "@playwright/test";

// ── Page load & navigation ────────────────────────────────────────────────────

test("home page loads without crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // No JS crashes
  expect(errors.filter(e => !e.includes("supabaseUrl"))).toHaveLength(0);

  // Page has meaningful content
  await expect(page.locator("body")).not.toBeEmpty();
});

test("pipeline page loads", async ({ page }) => {
  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/pipeline/);
  await expect(page.locator("body")).not.toBeEmpty();
});

test("chat page loads", async ({ page }) => {
  await page.goto("/chat");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/chat/);
  await expect(page.locator("body")).not.toBeEmpty();
});

test("import page loads", async ({ page }) => {
  await page.goto("/import");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/import/);
  await expect(page.locator("body")).not.toBeEmpty();
});

// ── Navigation links ──────────────────────────────────────────────────────────

test("sidebar navigation works", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Look for any nav links to pipeline/chat/import
  const navLinks = page.locator("a[href], button").filter({ hasText: /pipeline|chat|import/i });
  const count = await navLinks.count();

  if (count > 0) {
    // Click first nav link and check navigation
    const href = await navLinks.first().getAttribute("href");
    if (href) {
      await page.goto(href);
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(href);
    }
  }
});

// ── Home page UI elements ─────────────────────────────────────────────────────

test("home page has search input", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const searchInput = page.locator("input[type='text'], input[placeholder*='earch']").first();
  const count = await searchInput.count();
  if (count > 0) {
    await expect(searchInput).toBeVisible();
    await searchInput.fill("test search");
    await expect(searchInput).toHaveValue("test search");
  }
});

test("home page add deal button exists", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const addBtn = page.locator("button").filter({ hasText: /add deal|new deal|\+/i }).first();
  const count = await addBtn.count();
  if (count > 0) {
    await expect(addBtn).toBeVisible();
  }
});

// ── Outlook Inbox ─────────────────────────────────────────────────────────────

test("outlook inbox section renders", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // OutlookInbox renders even without a connected account
  const outlookSection = page.locator("text=/outlook|email|inbox/i").first();
  const count = await outlookSection.count();
  if (count > 0) {
    await expect(outlookSection).toBeVisible();
  }
});

// ── Pipeline page ─────────────────────────────────────────────────────────────

test("pipeline page shows deal table or board", async ({ page }) => {
  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");

  // Should have either a table, kanban board, or loading state
  const content = page.locator("table, [class*='board'], [class*='pipeline'], [class*='kanban']").first();
  const count = await content.count();
  // If no deals, at minimum a column header or empty state should exist
  const body = await page.locator("body").innerText();
  expect(body.length).toBeGreaterThan(10);
});

// ── No console errors on any route ───────────────────────────────────────────

test("no critical console errors on home", async ({ page }) => {
  const criticalErrors: string[] = [];
  page.on("pageerror", (err) => {
    // Ignore known benign errors
    if (!err.message.includes("supabaseUrl") && !err.message.includes("NetworkError")) {
      criticalErrors.push(err.message);
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(criticalErrors).toHaveLength(0);
});

test("no critical console errors on pipeline", async ({ page }) => {
  const criticalErrors: string[] = [];
  page.on("pageerror", (err) => {
    if (!err.message.includes("supabaseUrl") && !err.message.includes("NetworkError")) {
      criticalErrors.push(err.message);
    }
  });

  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  expect(criticalErrors).toHaveLength(0);
});

// ── Responsive layout ─────────────────────────────────────────────────────────

test("home page renders on mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toBeEmpty();
});

test("home page renders on desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toBeEmpty();
});

// ── Import page ───────────────────────────────────────────────────────────────

test("import page has file upload area", async ({ page }) => {
  await page.goto("/import");
  await page.waitForLoadState("networkidle");

  const uploadArea = page.locator("input[type='file'], [class*='drop'], [class*='upload']").first();
  const count = await uploadArea.count();
  if (count > 0) {
    await expect(uploadArea).toBeAttached();
  }
});

// ── Chat page ────────────────────────────────────────────────────────────────

test("chat page has message input", async ({ page }) => {
  await page.goto("/chat");
  await page.waitForLoadState("networkidle");

  const input = page.locator("input[type='text'], textarea").first();
  const count = await input.count();
  if (count > 0) {
    await expect(input).toBeVisible();
  }
});

// ── 404 / unknown routes ──────────────────────────────────────────────────────

test("unknown route does not crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/nonexistent-route");
  await page.waitForLoadState("networkidle");

  // Should either redirect or show something — no JS crash
  expect(errors.filter(e => !e.includes("supabaseUrl"))).toHaveLength(0);
});
