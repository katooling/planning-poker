import { expect } from "@playwright/test";

export async function createHost(page, name) {
    await page.locator("#displayNameInput").fill(name);
    await page.locator("#createRoomBtn").click();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
}

export async function startGameFromLobby(hostPage) {
    const startBtn = hostPage.locator("#hostStartGameBtn");
    const canStartNormally = await startBtn.isEnabled();
    if (!canStartNormally) {
        await hostPage.evaluate(() => {
            const button = document.getElementById("hostStartGameBtn");
            if (button) button.disabled = false;
        });
    }
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await expect(hostPage.locator("#tableView.active")).toBeVisible();
}

export async function startGameFromLobbyStrict(hostPage) {
    const startBtn = hostPage.locator("#hostStartGameBtn");
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await expect(hostPage.locator("#tableView.active")).toBeVisible();
}
