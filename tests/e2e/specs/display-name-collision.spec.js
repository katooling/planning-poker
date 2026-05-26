const { test, expect } = require("@playwright/test");
const {
    createHost,
    openHome,
    setConnectionMode,
    setConnectionPreferences,
    withSessionPages
} = require("../helpers");
const { connectGuestToHost } = require("../helpers/guest");

test("host rejects relay join when display name is taken by connected guest", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");
        const { DISPLAY_NAME_TAKEN_CODE } = await import("/js/display-name-collision.js");

        const hostId = "host-collision";
        const existingGuestId = "guest-existing";
        const newGuestId = "guest-new";
        const sentMessages = [];

        state.role = "host";
        state.localId = hostId;
        state.roomId = "room-collision";
        state.hostPendingRejoinRequests = [];
        state.hostRequireApprovalFirstJoin = true;
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
                [existingGuestId]: {
                    id: existingGuestId,
                    name: "Alex",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        };

        const relayChannel = {
            readyState: "open",
            send(data) {
                sentMessages.push(JSON.parse(String(data)));
            },
            close() {}
        };

        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: newGuestId, n: "Alex", pin: "" }),
            newGuestId,
            relayChannel
        );

        const reject = sentMessages.find((message) => message.t === "rejoinReject" && message.to === newGuestId);
        return {
            rejectCode: reject ? reject.code : null,
            rejectReason: reject ? reject.reason : null,
            pendingIds: (state.hostPendingRejoinRequests || []).map((entry) => entry.id),
            expectedCode: DISPLAY_NAME_TAKEN_CODE
        };
    });

    expect(result.rejectCode).toBe(result.expectedCode);
    expect(result.rejectReason).toMatch(/already in use/i);
    expect(result.pendingIds).toEqual([]);
});

test("host allows same guest id to reuse display name on relay join", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");

        const hostId = "host-self";
        const guestId = "guest-self";
        const sentMessages = [];

        state.role = "host";
        state.localId = hostId;
        state.roomId = "room-self";
        state.hostRequireApprovalFirstJoin = true;
        state.hostPendingRejoinRequests = [
            { id: guestId, name: "Alex", requestedAt: Date.now() }
        ];
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
                }
            }
        };

        const relayChannel = {
            readyState: "open",
            send(data) {
                sentMessages.push(JSON.parse(String(data)));
            },
            close() {}
        };

        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: guestId, n: "Alex", pin: "" }),
            guestId,
            relayChannel
        );

        const reject = sentMessages.find((message) => message.t === "rejoinReject" && message.to === guestId);
        return {
            rejected: !!reject,
            pendingIds: (state.hostPendingRejoinRequests || []).map((entry) => entry.id)
        };
    });

    expect(result.rejected).toBe(false);
    expect(result.pendingIds).toContain("guest-self");
});

test("host allows relay join when only disconnected guest has the name", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");
        const { DISPLAY_NAME_TAKEN_CODE } = await import("/js/display-name-collision.js");

        const hostId = "host-offline";
        const offlineGuestId = "guest-offline";
        const newGuestId = "guest-new-offline";
        const sentMessages = [];

        state.role = "host";
        state.localId = hostId;
        state.roomId = "room-offline";
        state.hostRequireApprovalFirstJoin = false;
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
                [offlineGuestId]: {
                    id: offlineGuestId,
                    name: "Alex",
                    connected: false,
                    vote: null,
                    isHost: false
                }
            }
        };

        const relayChannel = {
            readyState: "open",
            send(data) {
                sentMessages.push(JSON.parse(String(data)));
            },
            close() {}
        };

        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: newGuestId, n: "Alex", pin: "" }),
            newGuestId,
            relayChannel
        );

        const reject = sentMessages.find((message) => message.t === "rejoinReject" && message.to === newGuestId);
        const ack = sentMessages.find((message) => message.t === "rejoinAck" && message.to === newGuestId);
        return {
            rejectCode: reject ? reject.code : null,
            ackType: ack ? ack.t : null,
            expectedCode: DISPLAY_NAME_TAKEN_CODE
        };
    });

    expect(result.rejectCode).not.toBe(result.expectedCode);
    expect(result.ackType).toBe("rejoinAck");
});

test("guest invite link stays on form after display name collision reject", async ({ page }) => {
    await openHome(page);

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleGuestInboundMessage } = await import("/js/guest.js");
        const { DISPLAY_NAME_TAKEN_CODE, DISPLAY_NAME_TAKEN_REASON } = await import(
            "/js/display-name-collision.js"
        );

        state.role = "guest";
        state.displayName = "Alex";
        state.guestJoinContext = "joinLink";
        state.guestJoinPhase = "waitingApproval";
        state.joinLinkRoomCode = "room-link";
        state.roomId = "room-link";
        state.guestAutoRejoinEnabled = true;

        const fakeChannel = {
            readyState: "open",
            close() {},
            send() {}
        };
        state.guestChannel = fakeChannel;

        handleGuestInboundMessage(
            JSON.stringify({
                t: "rejoinReject",
                to: state.localId,
                code: DISPLAY_NAME_TAKEN_CODE,
                reason: DISPLAY_NAME_TAKEN_REASON
            }),
            fakeChannel
        );
    });

    await expect(page.locator("#joinLinkNotice")).toContainText(/already in use/i);
    await expect(page.locator("#joinLinkStatusPhase")).toBeHidden();
    await expect(page.locator("#displayNameInput")).toBeEnabled();
    await expect(page.locator("#joinRoomBtn")).toBeVisible();
    await expect(page.locator("#guestConnectView.active")).toHaveCount(0);
});

test("invite link blocks second browser using taken display name", async ({ browser }) => {
    await withSessionPages(browser, ["host", "guestA", "guestB"], async ({ host, guestA, guestB }) => {
        await openHome(host);
        await setConnectionPreferences(host, {
            mode: "mqttQuickJoin",
            hostRequireApprovalFirstJoin: false,
            hostAutoApproveKnownRejoin: true
        });
        await openHome(guestA);
        await openHome(guestB);
        await setConnectionMode(guestA, "mqttQuickJoin");
        await setConnectionMode(guestB, "mqttQuickJoin");
        await createHost(host, "HostCollision");
        const roomCode = String(await host.locator("#hostRoomCode").textContent() || "").trim();

        const firstJoin = await connectGuestToHost(host, guestA, "Alex");
        expect(firstJoin.connected).toBe(true);

        await guestB.goto("/?room=" + encodeURIComponent(roomCode));
        await guestB.locator("#displayNameInput").fill("Alex");
        await guestB.locator("#joinRoomBtn").click();

        await expect(guestB.locator("#joinLinkNotice")).toContainText(/already in use/i, { timeout: 12_000 });
        await expect(guestB.locator("#joinLinkStatusPhase")).toBeHidden();
        await expect(guestB.locator("#displayNameInput")).toBeEnabled();
        await expect(host.locator("#hostPlayerList .player-row", { hasText: "Alex" })).toHaveCount(1);

        await guestB.locator("#displayNameInput").fill("Alex (2)");
        await guestB.locator("#joinRoomBtn").click();
        await expect(guestB.locator("#joinLinkStatusPhase")).toBeVisible({ timeout: 12_000 });
        await expect.poll(async () => {
            return guestB.locator("#tableView.active").isVisible().catch(() => false);
        }, { timeout: 15_000 }).toBe(true);
    });
});
