import { expect, test } from "@playwright/test";
import {
    connectGuestToHost,
    createHost,
    openHome,
    playerCard,
    setConnectionMode,
    setConnectionModeForPages,
    setConnectionPreferences,
    startGameFromLobby,
    waitForGuestConnection,
} from "../helpers/index.js";

test("guest presence heartbeat sends immediate and periodic beats", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        window.__PP_TEST_PRESENCE_PING_INTERVAL_MS = 60;
        const sent = [];
        const { state } = window.__planningPokerE2E;
        const { onHostChannelOpen } = window.__planningPokerE2E;

        state.role = "guest";
        state.displayName = "GuestBeat";
        state.roomId = "room-beats";
        state.guestAutoRejoinEnabled = true;
        state.guestRemoteState = {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: [],
        };

        const channel = {
            readyState: "open",
            transportType: "mqtt-relay",
            isInboundStale: () => false,
            syncReadyState() {},
            send(data) {
                sent.push(JSON.parse(String(data)));
            },
            close() {},
        };

        state.guestChannel = channel;
        onHostChannelOpen(channel);
        await new Promise((resolve) => setTimeout(resolve, 160));

        const presence = sent.filter((message) => message.t === "presence");
        return {
            presence,
            phases: presence.map((message) => message.reason),
        };
    });

    expect(result.presence.length).toBeGreaterThanOrEqual(2);
    expect(result.phases[0]).toBe("immediate");
    expect(result.phases).toContain("beat");
});

test("host presence heartbeat triggers state broadcast every cycle", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = window.__planningPokerE2E;
        const { handleHostInboundMessage } = window.__planningPokerE2E;
        const { broadcastState } = window.__planningPokerE2E;

        const guestId = "guest-presence-sync";
        const hostId = "host-presence-sync";
        const outbound = [];
        const relay = {
            readyState: "open",
            transportType: "mqtt-relay",
            send(data) {
                outbound.push(JSON.parse(String(data)));
            },
        };

        state.role = "host";
        state.localId = hostId;
        state.roomId = "room-presence-sync";
        state.session = {
            round: 4,
            roundTitle: "Sprint sync",
            started: true,
            revealed: true,
            players: {
                [hostId]: {
                    id: hostId,
                    name: "Host",
                    connected: true,
                    vote: "8",
                    isHost: true,
                },
                [guestId]: {
                    id: guestId,
                    name: "Guest",
                    connected: true,
                    vote: "5",
                    isHost: false,
                },
            },
        };
        state.hostPeers.set(guestId, {
            id: guestId,
            name: "Guest",
            pc: null,
            dc: relay,
            connected: true,
        });

        outbound.length = 0;
        handleHostInboundMessage(
            guestId,
            JSON.stringify({ t: "presence", n: "Guest", reason: "beat" }),
        );
        const afterFirst = outbound.filter(
            (message) => message.t === "state" && message.to === guestId,
        );
        outbound.length = 0;
        handleHostInboundMessage(
            guestId,
            JSON.stringify({ t: "presence", n: "Guest", reason: "beat" }),
        );
        const afterSecond = outbound.filter(
            (message) => message.t === "state" && message.to === guestId,
        );

        return {
            afterFirstCount: afterFirst.length,
            afterSecondCount: afterSecond.length,
            firstRound: afterFirst[0] ? afterFirst[0].round : null,
            firstRevealed: afterFirst[0] ? afterFirst[0].revealed : null,
            firstTitle: afterFirst[0] ? afterFirst[0].roundTitle : null,
            broadcastStillWorks: typeof broadcastState === "function",
        };
    });

    expect(result.broadcastStillWorks).toBe(true);
    expect(result.afterFirstCount).toBe(1);
    expect(result.afterSecondCount).toBe(1);
    expect(result.firstRound).toBe(4);
    expect(result.firstRevealed).toBe(true);
    expect(result.firstTitle).toBe("Sprint sync");
});

test("stale mqtt health checks close channel only once per recovery", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = window.__planningPokerE2E;
        const { onHostChannelOpen, runGuestMqttHealthCheckForTest } = window.__planningPokerE2E;

        let closeCount = 0;
        const channel = {
            readyState: "open",
            transportType: "mqtt-relay",
            isInboundStale: () => true,
            syncReadyState() {},
            send() {},
            close() {
                closeCount += 1;
            },
        };

        state.role = "guest";
        state.displayName = "GuestSingleRecovery";
        state.roomId = "room-single-recovery";
        state.guestAutoRejoinEnabled = true;
        state.guestChannel = channel;
        onHostChannelOpen(channel);

        runGuestMqttHealthCheckForTest();
        runGuestMqttHealthCheckForTest();

        return {
            closeCount,
            phase: state.guestConnectionPhase,
        };
    });

    expect(result.closeCount).toBe(1);
    expect(result.phase).toBe("unstable");
});

test("guest remote state persists across connection status changes", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = window.__planningPokerE2E;
        const { handleGuestInboundMessage, getGuestSessionDiagnosticsForTest } =
            window.__planningPokerE2E;
        const { renderTable } = window.__planningPokerE2E;
        const { showView } = window.__planningPokerE2E;

        state.role = "guest";
        state.displayName = "GuestState";
        state.currentView = "table";
        state.roomId = "room-state";
        state.selectedVote = "8";
        state.guestRemoteState = {
            round: 3,
            roundTitle: "Carry over",
            started: true,
            revealed: false,
            players: [
                {
                    id: "host-1",
                    name: "Host",
                    connected: true,
                    isHost: true,
                    voted: false,
                    vote: null,
                },
                {
                    id: "guest-1",
                    name: "GuestState",
                    connected: true,
                    isHost: false,
                    voted: true,
                    vote: null,
                },
            ],
        };

        const channel = {
            readyState: "open",
            transportType: "webrtc",
            send() {},
            close() {},
        };
        state.guestChannel = channel;
        showView("table");
        renderTable();

        const beforeUnstable = getGuestSessionDiagnosticsForTest();
        state.guestConnectionPhase = "unstable";
        renderTable();
        const duringUnstable = getGuestSessionDiagnosticsForTest();

        handleGuestInboundMessage(
            JSON.stringify({
                t: "state",
                round: 3,
                roundTitle: "Carry over",
                started: true,
                revealed: true,
                players: state.guestRemoteState.players.map((player) => ({
                    ...player,
                    vote: player.id === "guest-1" ? "8" : "5",
                })),
            }),
            channel,
        );
        const afterReveal = getGuestSessionDiagnosticsForTest();

        state.guestConnectionPhase = "reconnecting";
        renderTable();
        const duringReconnect = getGuestSessionDiagnosticsForTest();

        return { beforeUnstable, duringUnstable, afterReveal, duringReconnect };
    });

    expect(result.beforeUnstable.remoteState.round).toBe(3);
    expect(result.beforeUnstable.remoteState.revealed).toBe(false);
    expect(result.beforeUnstable.selectedVote).toBe("8");

    expect(result.duringUnstable.remoteState.round).toBe(3);
    expect(result.duringUnstable.remoteState.revealed).toBe(false);
    expect(result.duringUnstable.phase).toBe("unstable");
    expect(result.duringUnstable.connectionText).toContain("unstable");

    expect(result.afterReveal.remoteState.round).toBe(3);
    expect(result.afterReveal.remoteState.revealed).toBe(true);

    expect(result.duringReconnect.remoteState.round).toBe(3);
    expect(result.duringReconnect.remoteState.revealed).toBe(true);
    expect(result.duringReconnect.phase).toBe("reconnecting");
});

test("live mqtt guest survives simulated idle and syncs host reveal", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await setConnectionPreferences(host, {
        mode: "mqttQuickJoin",
        hostRequireApprovalFirstJoin: true,
        hostAutoApproveKnownRejoin: true,
    });
    await setConnectionModeForPages([host, guest], "mqttQuickJoin");
    await createHost(host, "HostIdle");
    const guestConnection = await connectGuestToHost(host, guest, "GuestIdle");
    test.skip(!guestConnection.connected, "MQTT guest channel did not open in this environment.");

    await startGameFromLobby(host);
    await expect(guest.locator("#tableView.active")).toBeVisible();
    await host.locator('#votePalette .vote-card[data-vote="5"]').click();
    await guest.locator('#votePalette .vote-card[data-vote="8"]').click();

    await guest.evaluate(async () => {
        window.__PP_TEST_MQTT_INBOUND_STALE_MS = 120;
        window.__PP_TEST_MQTT_HEALTH_CHECK_MS = 40;
        const { ageGuestMqttInboundForTest, runGuestMqttHealthCheckForTest } =
            window.__planningPokerE2E;
        ageGuestMqttInboundForTest(200);
        runGuestMqttHealthCheckForTest();
    });

    await expect
        .poll(async () => guest.locator("#connectionStatusText").textContent(), { timeout: 20_000 })
        .toMatch(/unstable|Reconnecting|Connected to host/i);

    await expect
        .poll(
            async () => {
                const text = await guest.locator("#connectionStatusText").textContent();
                return /Connected to host/i.test(String(text || ""));
            },
            { timeout: 45_000 },
        )
        .toBe(true);

    await host.locator("#hostRevealBtn").click();
    const hostCard = playerCard(host, "HostIdle");
    const guestCard = playerCard(guest, "GuestIdle");
    await expect(hostCard).toHaveClass(/revealed/);
    await expect(guestCard).toHaveClass(/revealed/, { timeout: 15_000 });
    await expect(guest.locator("#statAverage")).toHaveText("6.50");

    const afterReveal = await guest.evaluate(async () => {
        const { getGuestSessionDiagnosticsForTest } = window.__planningPokerE2E;
        return getGuestSessionDiagnosticsForTest();
    });
    expect(afterReveal.remoteState.revealed).toBe(true);
    expect(afterReveal.remoteState.round).toBe(1);
});
