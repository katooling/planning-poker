const { test, expect } = require("@playwright/test");
const {
    createHost,
    openHome,
    setConnectionMode,
    setConnectionPreferences,
    isHostRecoveryRelayOpen,
    requestMqttGuestJoin,
    expectHostPendingGuest
} = require("../helpers");

test("host pending banner lists guest after relay rejoin is queued", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostQueue");

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");
        const { renderHostLobby } = await import("/js/render.js");

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

    const relayOpen = await isHostRecoveryRelayOpen(host);
    expect(relayOpen, "Host MQTT recovery relay must open before pending join can be requested.").toBe(true);

    const roomCode = String(await host.locator("#hostRoomCode").textContent() || "").trim();
    await requestMqttGuestJoin(guest, { roomCode, guestName: "GuestPendingBanner" });
    await expectHostPendingGuest(host, "GuestPendingBanner", { guestPage: guest });
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
