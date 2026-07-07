const { test, expect } = require("@playwright/test");
const { openConnectionSettings, openHome, saveConnectionSettings, setConnectionPreferences } = require("../helpers");

test("connection settings dialog persists custom ICE servers", async ({ page }) => {
    await openHome(page);

    await openConnectionSettings(page);
    await expect(page.locator("#defaultIceServersList")).toContainText("stun:stun.l.google.com:19302");

    const customServers = [
        "turn:example.com:3478?transport=tcp | alice | s3cret",
        "stun:stun.example.com:3478"
    ].join("\n");
    await page.locator("#customIceServersInput").fill(customServers);
    await saveConnectionSettings(page);
    await expect(page.locator("#homeNotice")).toContainText("Connection settings saved");

    await openConnectionSettings(page);
    await expect(page.locator("#customIceServersInput")).toHaveValue(/turn:example\.com:3478\?transport=tcp/);
    await expect(page.locator("#customIceServersInput")).toHaveValue(/stun:stun\.example\.com:3478/);
    await page.locator("#iceSettingsCancelBtn").click();
});

test("connection settings persist strategy and MQTT admission toggles", async ({ page }) => {
    await openHome(page);
    await setConnectionPreferences(page, {
        mode: "manualWebRtc",
        hostRequireApprovalFirstJoin: false,
        hostAutoApproveKnownRejoin: false
    });
    await expect(page.locator("#homeNotice")).toContainText("Connection settings saved");

    await openConnectionSettings(page);
    await expect(page.locator("#connectionStrategySelect")).toHaveValue("manualWebRtc");
    await expect(page.locator("#hostRequireApprovalFirstJoinCheckbox")).not.toBeChecked();
    await expect(page.locator("#hostAutoApproveKnownRejoinCheckbox")).not.toBeChecked();
    await page.locator("#iceSettingsCancelBtn").click();
});

test("theme toggle switches dark mode and persists after reload", async ({ page }) => {
    await openHome(page);

    const themeToggle = page.getByTestId("btn-theme-toggle");
    await expect(themeToggle).toHaveText("Dark Theme");
    await expect(themeToggle).toHaveAttribute("aria-pressed", "false");

    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(themeToggle).toHaveText("Light Theme");
    await expect(themeToggle).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(themeToggle).toHaveText("Light Theme");

    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(themeToggle).toHaveText("Dark Theme");
});
