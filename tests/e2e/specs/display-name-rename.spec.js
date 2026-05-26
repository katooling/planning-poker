const { test, expect } = require("@playwright/test");
const {
    connectGuestToHost,
    createHost,
    openHome,
    playerCard,
    startGameFromLobby
} = require("../helpers");

test("host rejects in-session rename when display name is taken", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleHostInboundMessage } = await import("/js/host-peers.js");
        const { DISPLAY_NAME_TAKEN_CODE } = await import("/js/display-name-collision.js");

        const hostId = "host-rename";
        const guestA = "guest-a";
        const guestB = "guest-b";
        const sentMessages = [];

        state.role = "host";
        state.localId = hostId;
        state.hostPeers = new Map([
            [
                guestB,
                {
                    id: guestB,
                    name: "GuestB",
                    connected: true,
                    dc: {
                        readyState: "open",
                        send(data) {
                            sentMessages.push(JSON.parse(String(data)));
                        }
                    }
                }
            ]
        ]);
        state.session = {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: {
                [hostId]: {
                    id: hostId,
                    name: "Host",
                    connected: true,
                    vote: null,
                    isHost: true
                },
                [guestA]: {
                    id: guestA,
                    name: "Alex",
                    connected: true,
                    vote: null,
                    isHost: false
                },
                [guestB]: {
                    id: guestB,
                    name: "GuestB",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        };

        handleHostInboundMessage(guestB, JSON.stringify({ t: "name", n: "Alex" }));

        const reject = sentMessages.find((message) => message.t === "nameReject" && message.to === guestB);
        return {
            rejectCode: reject ? reject.code : null,
            guestBName: state.session.players[guestB].name,
            expectedCode: DISPLAY_NAME_TAKEN_CODE
        };
    });

    expect(result.rejectCode).toBe(result.expectedCode);
    expect(result.guestBName).toBe("GuestB");
});

test("host applies in-session rename and keeps roster unique", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleHostInboundMessage } = await import("/js/host-peers.js");

        const hostId = "host-rename-ok";
        const guestId = "guest-rename-ok";

        state.role = "host";
        state.localId = hostId;
        state.hostPeers = new Map([
            [
                guestId,
                {
                    id: guestId,
                    name: "Before",
                    connected: true,
                    dc: { readyState: "open", send() {} }
                }
            ]
        ]);
        state.session = {
            round: 1,
            roundTitle: "",
            started: true,
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
                    name: "Before",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        };

        handleHostInboundMessage(guestId, JSON.stringify({ t: "name", n: "After" }));

        return {
            guestName: state.session.players[guestId].name,
            peerName: state.hostPeers.get(guestId).name
        };
    });

    expect(result.guestName).toBe("After");
    expect(result.peerName).toBe("After");
});

test("host cannot rename to a connected guest display name", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { applyHostDisplayNameRename } = await import("/js/host-session.js");

        const hostId = "host-blocked";
        const guestId = "guest-blocked";

        state.role = "host";
        state.localId = hostId;
        state.displayName = "Host";
        state.session = {
            round: 1,
            roundTitle: "",
            started: true,
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
                    name: "Alex",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        };

        const rename = applyHostDisplayNameRename("Alex");
        return {
            applied: rename.applied,
            hostName: state.session.players[hostId].name
        };
    });

    expect(result.applied).toBe(false);
    expect(result.hostName).toBe("Host");
});

test("guest rename propagates to other players at the table", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guestA = await context.newPage();
    const guestB = await context.newPage();

    await openHome(host);
    await openHome(guestA);
    await openHome(guestB);

    await createHost(host, "HostRename");
    const connA = await connectGuestToHost(host, guestA, "GuestAlpha");
    const connB = await connectGuestToHost(host, guestB, "GuestBeta");
    test.skip(!connA.connected || !connB.connected, "Requires connected WebRTC guests");

    await startGameFromLobby(host);
    await expect(guestA.locator("#tableView.active")).toBeVisible();
    await expect(guestB.locator("#tableView.active")).toBeVisible();

    await guestA.locator("#displayNameInput").fill("RenamedAlpha");
    await guestA.locator("#displayNameInput").blur();

    await expect(playerCard(host, "RenamedAlpha")).toBeVisible({ timeout: 15_000 });
    await expect(playerCard(guestB, "RenamedAlpha")).toBeVisible({ timeout: 15_000 });
    await expect(guestA.locator("#displayNameInput")).toHaveValue("RenamedAlpha");
});

test("guest handles nameReject without auto-rejoin", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleGuestInboundMessage } = await import("/js/guest.js");
        const { DISPLAY_NAME_TAKEN_CODE } = await import("/js/display-name-collision.js");

        state.role = "guest";
        state.localId = "guest-reject";
        state.displayName = "GuestBeta";
        state.currentView = "table";
        state.guestRemoteState = {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: [
                { id: "guest-reject", name: "GuestBeta", connected: true, isHost: false, voted: false, vote: null }
            ]
        };

        const channel = { readyState: "open", close() {} };
        state.guestChannel = channel;

        document.getElementById("displayNameInput").value = "Alex";

        handleGuestInboundMessage(
            JSON.stringify({
                t: "nameReject",
                to: "guest-reject",
                code: DISPLAY_NAME_TAKEN_CODE,
                reason: "That name is already in use."
            }),
            channel
        );

        return {
            displayName: state.displayName,
            inputValue: document.getElementById("displayNameInput").value,
            inputHasError: document.getElementById("displayNameInput").classList.contains("name-input-error"),
            activeElementId: document.activeElement ? document.activeElement.id : ""
        };
    });

    expect(result.displayName).toBe("GuestBeta");
    expect(result.inputValue).toBe("GuestBeta");
    expect(result.inputHasError).toBe(true);
    expect(result.activeElementId).toBe("displayNameInput");
});

test("guest rename to taken name is rejected without changing roster name", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guestA = await context.newPage();
    const guestB = await context.newPage();

    await openHome(host);
    await openHome(guestA);
    await openHome(guestB);

    await createHost(host, "HostRenameBlock");
    const connA = await connectGuestToHost(host, guestA, "GuestAlpha");
    const connB = await connectGuestToHost(host, guestB, "GuestBeta");
    test.skip(!connA.connected || !connB.connected, "Requires connected WebRTC guests");

    await startGameFromLobby(host);
    await expect(guestB.locator("#tableView.active")).toBeVisible();

    await guestB.locator("#displayNameInput").fill("GuestAlpha");
    await guestB.locator("#displayNameInput").blur();

    await expect(guestB.locator("#tableNotice")).toContainText(/already in use/i, { timeout: 15_000 });
    await expect(guestB.locator("#displayNameInput")).toHaveValue("GuestBeta");
    await expect(playerCard(host, "GuestBeta")).toBeVisible();
});
