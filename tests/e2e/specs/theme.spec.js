const { test, expect } = require("@playwright/test");
const { openHome } = require("../helpers");

test("theme toggle switches theme and persists after reload", async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem("planning-poker-theme", "light");
    });
    await openHome(page);

    const themeToggle = page.getByTestId("toggle-theme");
    await expect(themeToggle).not.toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await themeToggle.check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#themeToggleLabel")).toHaveText("Dark");

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("toggle-theme")).toBeChecked();
});
