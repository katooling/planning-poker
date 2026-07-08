const { test, expect } = require("@playwright/test");
const { createHost, openHome, withSessionPages } = require("../helpers");

test("create/join requires a display name", async ({ page }) => {
    await openHome(page);

    await page.getByTestId("btn-create-room").click();
    await expect(page.locator("#homeNotice")).toContainText("Please enter your display name.");
    await expect(page.locator("#homeView.active")).toBeVisible();

    await page.getByTestId("btn-join-room").click();
    await expect(page.locator("#homeNotice")).toContainText("Please enter your display name.");
    await expect(page.locator("#homeView.active")).toBeVisible();
});

test("host and guest back actions return to home", async ({ browser }) => {
    await withSessionPages(browser, ["host", "guest"], async ({ host, guest }) => {
        await openHome(host);
        await openHome(guest);

        await createHost(host, "HostBack");
        await host.locator("#hostBackHomeBtn").click();
        await expect(host.locator("#homeView.active")).toBeVisible();

        await guest.locator("#displayNameInput").fill("GuestBack");
        await guest.getByTestId("btn-join-room").click();
        await expect(guest.locator("#guestConnectView.active")).toBeVisible();
        await guest.getByTestId("btn-guest-back-home").click();
        await expect(guest.locator("#homeView.active")).toBeVisible();
    });
});

test("guest reconnect path from disconnected table returns to join flow", async ({ page }) => {
    await openHome(page);

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");

        state.role = "guest";
        state.displayName = "GuestReconnect";
        state.roomId = "room-reconnect";
        state.guestAutoRejoinEnabled = true;
        state.guestChannel = null;
        state.guestRemoteState = {
            round: 2,
            roundTitle: "Reconnect Round",
            started: true,
            revealed: false,
            players: [
                { id: "host1", name: "Host", connected: false, isHost: true, voted: false, vote: null },
                { id: "guest1", name: "GuestReconnect", connected: false, isHost: false, voted: false, vote: null }
            ]
        };
        showView("table");
        renderTable();
    });

    await expect(page.getByTestId("btn-leave-session")).toHaveText("Reconnect");
    await page.getByTestId("btn-leave-session").click();

    await expect(page.locator("#guestConnectView.active")).toBeVisible();
    await expect(page.locator("#guestConnectNotice")).toContainText(
        /Session restored|Retrying relay reconnect/
    );
    await expect(page.locator("#guestRoomCodeInput")).toHaveValue("room-reconnect");
});

test("display name is sanitized and restored after reload", async ({ page }) => {
    await openHome(page);

    const noisyName = "   Alice      Bob      Carol      With      Extra      Spaces   ";
    await page.locator("#displayNameInput").fill(noisyName);
    await page.reload();

    const restored = await page.locator("#displayNameInput").inputValue();
    expect(restored).toBe("Alice Bob Carol With");
    expect(restored.length).toBeLessThanOrEqual(40);
});

test("theme toggle switches theme and persists after reload", async ({ page }) => {
    await openHome(page);

    const toggle = page.getByTestId("btn-theme-toggle");
    await expect(toggle).toHaveText("Dark Theme");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(toggle).toHaveText("Light Theme");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(toggle).toHaveText("Light Theme");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
