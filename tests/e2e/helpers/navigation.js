import { expect } from "@playwright/test";

export async function openHome(page) {
    await page.goto("/");
    await expect(page.locator("#homeView.active")).toBeVisible();
}

export async function openConnectionSettings(page) {
    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#iceSettingsDialog")).toBeVisible();
}

export async function saveConnectionSettings(page) {
    await page.locator("#iceSettingsSaveBtn").click();
}

export async function setConnectionPreferences(page, preferences = {}) {
    await openConnectionSettings(page);

    if (typeof preferences.mode === "string") {
        await page.locator("#connectionStrategySelect").selectOption(preferences.mode);
    }
    if (typeof preferences.hostRequireApprovalFirstJoin === "boolean") {
        await page
            .locator("#hostRequireApprovalFirstJoinCheckbox")
            .setChecked(preferences.hostRequireApprovalFirstJoin);
    }
    if (typeof preferences.hostAutoApproveKnownRejoin === "boolean") {
        await page
            .locator("#hostAutoApproveKnownRejoinCheckbox")
            .setChecked(preferences.hostAutoApproveKnownRejoin);
    }

    await saveConnectionSettings(page);
}

export async function setConnectionMode(page, mode) {
    await setConnectionPreferences(page, { mode });
}

export async function setConnectionModeForPages(pages, mode) {
    for (const page of pages) {
        await setConnectionMode(page, mode);
    }
}
