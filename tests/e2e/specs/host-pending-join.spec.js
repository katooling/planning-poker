const { test, expect } = require("@playwright/test");
const {
    createHost,
    openHome,
    startGameFromLobby,
    setConnectionMode,
    setConnectionPreferences,
    isHostRecoveryRelayOpen,
    requestMqttGuestJoin,
    expectHostPendingGuest,
    withSessionPages
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
    await expect.poll(async () => page.evaluate(() => {
        const roomAccess = document.getElementById("hostRoomAccessPanel");
        const banner = document.getElementById("hostPendingRejoinBanner");
        return roomAccess && banner ? roomAccess.firstElementChild === banner : false;
    })).toBe(true);
});

test("host pending banner appears when guest requests mqtt join approval", async ({ browser }) => {
    await withSessionPages(browser, ["host", "guest"], async ({ host, guest }) => {
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
});

test("host can approve and reject pending rejoins from the table", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostTablePending");
    await startGameFromLobby(page);

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { renderTable } = await import("/js/render.js");

        const sent = [];
        state.hostRecoveryRelay = {
            readyState: "open",
            send(data) {
                sent.push(JSON.parse(String(data)));
            },
            close() {}
        };
        state.hostPendingRejoinRequests = [
            { id: "guest-table-1", name: "Table One", requestedAt: Date.now() },
            { id: "guest-table-2", name: "Table Two", requestedAt: Date.now() }
        ];
        window.__tableRejoinSent = sent;
        renderTable();
    });

    await expect(page.getByTestId("banner-table-pending-rejoin")).toBeVisible();
    await expect(page.locator("#tablePendingRejoinBannerTitle")).toContainText("2 guests waiting to rejoin");
    await expect(page.locator("#tablePendingRejoinList")).toContainText("Table One");
    await expect(page.locator("#tablePendingRejoinList")).toContainText("Table Two");
    await expect(page.locator("#leaveSessionPendingBadge")).toHaveText("2");
    await expect.poll(async () => page.evaluate(() => {
        const votePanel = document.getElementById("votePalette")?.closest(".panel");
        const banner = document.getElementById("tablePendingRejoinBanner");
        if (!votePanel || !banner) return false;
        return !!(votePanel.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);

    await page.locator("#tablePendingRejoinList").locator('[data-approve-rejoin="guest-table-1"]').click();
    await expect(page.locator("#tablePendingRejoinList")).not.toContainText("Table One");
    await expect(page.locator("#leaveSessionPendingBadge")).toHaveText("1");

    await page.locator("#tablePendingRejoinList").locator('[data-reject-rejoin="guest-table-2"]').click();
    await expect(page.getByTestId("banner-table-pending-rejoin")).toBeHidden();
    await expect(page.locator("#leaveSessionPendingBadge")).toBeHidden();

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        return {
            sent: window.__tableRejoinSent || [],
            pendingCount: Array.isArray(state.hostPendingRejoinRequests)
                ? state.hostPendingRejoinRequests.length
                : -1,
            approvedConnected: !!(
                state.session
                && state.session.players
                && state.session.players["guest-table-1"]
                && state.session.players["guest-table-1"].connected
            )
        };
    });
    expect(result.pendingCount).toBe(0);
    expect(result.approvedConnected).toBe(true);
    expect(result.sent.some((msg) => msg.t === "rejoinAck" && msg.to === "guest-table-1")).toBe(true);
    expect(result.sent.some((msg) => msg.t === "rejoinReject" && msg.to === "guest-table-2")).toBe(true);
});

test("table approve failure shows the recovery relay warning on the table", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostTableWarn");
    await startGameFromLobby(page);

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { renderTable } = await import("/js/render.js");

        state.hostRecoveryRelay = null;
        state.hostPendingRejoinRequests = [
            { id: "guest-table-warn", name: "Table Warn", requestedAt: Date.now() }
        ];
        renderTable();
    });

    await page.locator("#tablePendingRejoinList").locator('[data-approve-rejoin="guest-table-warn"]').click();
    await expect(page.locator("#tableNotice")).toContainText("Recovery relay is not ready");
    await expect(page.locator("#hostLobbyNotice")).not.toContainText("Recovery relay is not ready");
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
