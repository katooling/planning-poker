const { test, expect } = require("@playwright/test");
const { createHost, openHome } = require("../helpers");

test("relay rejoin queues pending guest and collision rejects second id", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostGate");

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");
        const { DISPLAY_NAME_TAKEN_CODE } = await import("/js/display-name-collision.js");

        const sent = [];
        const relay = {
            readyState: "open",
            send(data) {
                sent.push(JSON.parse(String(data)));
            },
            close() {}
        };

        state.hostRequireApprovalFirstJoin = true;
        state.hostPendingRejoinRequests = [];
        state.hostRecoveryRelay = relay;

        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: "guest-a", n: "Alex", pin: "" }),
            "guest-a",
            relay
        );
        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: "guest-b", n: "Alex", pin: "" }),
            "guest-b",
            relay
        );

        return {
            pendingIds: (state.hostPendingRejoinRequests || []).map((entry) => entry.id),
            reject: sent.find((msg) => msg.t === "rejoinReject" && msg.to === "guest-b"),
            expectedCode: DISPLAY_NAME_TAKEN_CODE
        };
    });

    expect(result.pendingIds).toEqual(["guest-a"]);
    expect(result.reject?.code).toBe(result.expectedCode);
});

test("approve pending relay join connects guest and presence ping does not throw", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostApproveFlow");

    const guestId = "guest-approve-contract";
    const guestName = "GuestApproveContract";

    const result = await page.evaluate(
        async ({ guestId, guestName }) => {
            const { state } = await import("/js/state.js");
            const {
                onHostRecoveryRelayMessage,
                approvePendingRejoin,
                handleHostInboundMessage
            } = await import("/js/host-peers.js");
            const { renderHostLobby } = await import("/js/render.js");

            const sent = [];
            const relay = {
                readyState: "open",
                send(data) {
                    sent.push(JSON.parse(String(data)));
                },
                close() {}
            };

            state.hostRequireApprovalFirstJoin = true;
            state.hostPendingRejoinRequests = [];
            state.hostRecoveryRelay = relay;

            onHostRecoveryRelayMessage(
                JSON.stringify({ t: "rejoin", id: guestId, n: guestName, pin: "" }),
                guestId,
                relay
            );

            let presenceThrew = false;
            approvePendingRejoin(guestId);
            try {
                handleHostInboundMessage(
                    guestId,
                    JSON.stringify({ t: "presence", n: guestName, reason: "beat" })
                );
            } catch (_error) {
                presenceThrew = true;
            }

            renderHostLobby();

            const player = state.session.players[guestId];
            return {
                pendingIds: (state.hostPendingRejoinRequests || []).map((entry) => entry.id),
                sentAck: sent.some((msg) => msg.t === "rejoinAck" && msg.to === guestId),
                playerConnected: !!(player && player.connected),
                playerName: player ? player.name : null,
                presenceThrew
            };
        },
        { guestId, guestName }
    );

    expect(result.pendingIds).toEqual([]);
    expect(result.sentAck).toBe(true);
    expect(result.playerConnected).toBe(true);
    expect(result.playerName).toBe(guestName);
    expect(result.presenceThrew).toBe(false);

    await expect(page.getByTestId("banner-pending-rejoin")).toBeHidden();
    await expect(page.locator("#hostPlayerList")).toContainText(guestName);
    await expect(page.locator("#hostPlayerList")).toContainText("Online");
});
