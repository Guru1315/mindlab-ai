import { expect, test } from "@playwright/test";

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("landing page", () => {
  test("renders hero, features, pricing and FAQ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("your own");
    await expect(page.getByRole("heading", { name: /shows its work/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Start free/i })).toBeVisible();
    await expect(page.locator("#pricing")).toContainText("$0");

    const question = page.getByRole("button", { name: /How does MindLab avoid making things up/i });
    await question.scrollIntoViewIfNeeded();
    await question.click();
    await expect(page.getByText(/Citation numbers are checked/)).toBeVisible();
  });

  test("calls to action lead to sign-up", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Create your first notebook/i }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: /Create your account/i })).toBeVisible();
  });

  test("is responsive without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    await expectNoHorizontalScroll(page);
  });

  test("theme can be switched to dark", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});

test.describe("authentication screens", () => {
  test("login offers Google and email sign-in with recovery links", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.getByRole("link", { name: /Forgot password/i }).click();
    await expect(page.getByRole("heading", { name: /Reset your password/i })).toBeVisible();
  });

  test("shows an error when sign-in fails instead of navigating", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("someone@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    // Next.js adds its own (empty) route-announcer alert, so match the form error by content.
    const error = page.getByRole("alert").filter({ hasText: /sign-in|incorrect|try again/i });
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).not.toContainText("Failed to fetch");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sign-up requires a valid email and an 8+ character password", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByLabel("Name")).toBeVisible();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    const valid = await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(valid).toBe(false);
    await expect(page).toHaveURL(/\/signup/);
  });

  test("auth pages fit mobile screens", async ({ page }) => {
    await page.goto("/login");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("route protection", () => {
  for (const path of ["/dashboard", "/settings", "/notebooks/3f2b8a1e-7c4d-4e5f-9a6b-1c2d3e4f5a6b"]) {
    test(`${path} redirects anonymous visitors to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    });
  }

  test("API returns 401 JSON without a session", async ({ request }) => {
    const res = await request.get("/api/notebooks");
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  test("security headers are set", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("unknown share links show a not-found page", async ({ page }) => {
    const res = await page.goto("/share/this-token-does-not-exist-123456");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/doesn't exist/i)).toBeVisible();
  });
});
