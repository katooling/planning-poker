const { test, expect } = require("@playwright/test");
const {
    createHost,
    openHome,
    setConnectionMode,
    setConnectionPreferences
} = require("../helpers");

async function waitForHostRecoveryRelayOpen(hostPage, timeoutMs = 25_000) {
    await expect.poll(
        async () => hostPage.evaluate(async () => {
            const { state } = await import("/js/state.js");
            return state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "open";
        }),
        { timeout: timeoutMs, intervals: [250, 500, 1000] }
    ).toBe(true);
}

test("host pending banner lists guest after relay rejoin is queued", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostQueue");

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");
        const { renderHostLobby } = await import("/js/render.js");

        const hostId = state.localId;
        const guestId = "guest-queue-test";
        state.hostRequireApprovalFirstJoin = true;
        state.hostPendingRejoinRequests = [];
        state.hostRecoveryRelay = {
            readyState: "open",
            send() {},
            close() {}
        };

        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: guestId, n: "GuestQueue", pin: "" }),
            guestId,
            state.hostRecoveryRelay
        );
        renderHostLobby();
    });

    await expect(page.getByTestId("banner-pending-rejoin")).toBeVisible();
    await expect(page.locator("#hostPendingRejoinList")).toContainText("GuestQueue");
});

test("host pending banner appears when guest requests mqtt join approval", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await setConnectionPreferences(host, {
        mode: "mqttQuickJoin",
        hostRequireApprovalFirstJoin: true,
        hostAutoApproveKnownRejoin: true
    });
    await setConnectionMode(guest, "mqttQuickJoin");
    await createHost(host, "HostPendingBanner");

    let relayOpen = false;
    try {
        await waitForHostRecoveryRelayOpen(host, 15_000);
        relayOpen = true;
    } catch (_error) {
        relayOpen = false;
    }
    test.skip(!relayOpen, "Host MQTT recovery relay did not open in this environment.");

    const roomCode = String(await host.locator("#hostRoomCode").textContent() || "").trim();

    await guest.locator("#displayNameInput").fill("GuestPendingBanner");
    await guest.locator("#joinRoomBtn").click();
    await guest.locator("#guestRoomCodeInput").fill(roomCode);
    await guest.locator("#connectGuestRoomBtn").click();

    await expect(host.getByTestId("banner-pending-rejoin")).toBeVisible({ timeout: 12_000 });
    await expect(host.locator("#hostPendingRejoinList")).toContainText("GuestPendingBanner");
    await expect(guest.locator("#tableView.active")).toHaveCount(0);
});

test("host presence handler survives guest presence ping after approval", async ({ page }) => {
    await openHome(page);

    const threw = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleHostInboundMessage } = await import("/js/host-peers.js");

        const hostId = "host-presence";
        const guestId = "guest-presence";
        state.role = "host";
        state.localId = hostId;
        state.roomId = "room-presence";
        state.hostPendingRejoinRequests = [];
        state.session = {
            round: 1,
            roundTitle: "",
            started: false,
            revealed: false,
            players: {
                [hostId]: {
                    id: hostId,
                    name: "Host",
                    connected: true,
                    vote: null,
                    isHost: true
                },
                [guestId]: {
                    id: guestId,
                    name: "GuestPing",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        };
        state.hostPeers.set(guestId, {
            id: guestId,
            name: "GuestPing",
            pc: null,
            dc: { readyState: "open", send() {} },
            connected: true
        });

        try {
            handleHostInboundMessage(
                guestId,
                JSON.stringify({ t: "presence", n: "GuestPing", reason: "beat" })
            );
            return false;
        } catch (_error) {
            return true;
        }
    });

    expect(threw).toBe(false);
});
