import { expect, test } from "@playwright/test";

const storeId = "00000000-0000-4000-8000-000000000001";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/web/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        tenant: { id: "tenant-demo", name: "SHEIN涵舟工作室" },
        user: {
          id: "user-demo",
          email: "demo@hanzhou.icu",
          displayName: "验收管理员",
          role: "owner",
        },
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/v1/web/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
});

test("login, scoped product routes, and logout remain deterministic without live SHEIN", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle("SHEIN超级运营中心");
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();

  await page.getByLabel("邮箱").fill("demo@hanzhou.icu");
  await page.getByLabel("密码").fill("deterministic-staging-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/app\/overview$/);
  await expect(page.getByText("总览", { exact: true }).first()).toBeVisible();

  for (const route of ["products/new", "products/batch-new", "products/drafts", "publishing", "compliance"]) {
    await page.goto(`/app/operations/${storeId}/${route}`);
    await expect(page).toHaveURL(new RegExp(`/app/operations/${storeId}/${route}$`));
  }

  await page.getByRole("button", { name: "打开用户菜单" }).click();
  await page.getByText("退出登录", { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
});

test("V2 marker and deep route fallback remain stable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(`/app/operations/${storeId}/products/new`);
  await expect(page).toHaveURL(new RegExp(`/app/operations/${storeId}/products/new$`));
  await expect(page.locator('meta[name="polaris-ui"]')).toHaveAttribute("content", "v2");
  await expect(page.locator("body")).not.toContainText("全托管运营助手");
  await expect(page.locator("body")).not.toContainText("网页协作版");
});
