const { expect } = require("@playwright/test");

/**
 * Poll until host recovery MQTT relay is open, or throw on timeout.
 */
async function waitForHostRecoveryRelayOpen(hostPage, timeoutMs = 15_000) {
    await expect.poll(
        async () => hostPage.evaluate(async () => {
            const { state } = await import("/js/state.js");
            return !!(state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "open");
        }),
        { timeout: timeoutMs, intervals: [250, 500, 1000] }
    ).toBe(true);
}

/**
 * @returns {Promise<boolean>}
 */
async function isHostRecoveryRelayOpen(hostPage) {
    try {
        await waitForHostRecoveryRelayOpen(hostPage, 15_000);
        return true;
    } catch (_error) {
        return false;
    }
}

async function requestMqttGuestJoin(guestPage, { roomCode, guestName, pin = "" }) {
    await guestPage.locator("#displayNameInput").fill(guestName);
    await guestPage.locator("#joinRoomBtn").click();
    await guestPage.locator("#guestRoomCodeInput").fill(roomCode);
    if (pin) {
        await guestPage.locator("#guestRoomPinInput").fill(pin);
    }
    await guestPage.locator("#connectGuestRoomBtn").click();
}

async function expectHostPendingGuest(hostPage, guestName, options = {}) {
    const guestNotAtTable = options.guestPage
        ? expect(options.guestPage.locator("#tableView.active")).toHaveCount(0)
        : null;

    await expect(hostPage.getByTestId("banner-pending-rejoin")).toBeVisible({
        timeout: options.timeoutMs || 12_000
    });
    await expect(hostPage.locator("#hostPendingRejoinList")).toContainText(guestName);
    if (guestNotAtTable) {
        await guestNotAtTable;
    }
}

module.exports = {
    waitForHostRecoveryRelayOpen,
    isHostRecoveryRelayOpen,
    requestMqttGuestJoin,
    expectHostPendingGuest
};
