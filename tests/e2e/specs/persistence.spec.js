const { test, expect } = require("@playwright/test");
const { createHost, openHome, setRuntimeOverrides, startGameFromLobby } = require("../helpers");

test("host session snapshot restores table context after refresh", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostPersist");
    await startGameFromLobby(page);
    await page.locator("#hostRoundTitleInput").fill("Resilience");
    await page.locator('#votePalette .vote-card[data-vote="13"]').click();

    await page.reload();

    await expect(page.locator("#tableView.active")).toBeVisible();
    await expect(page.locator("#tableSubtitle")).toContainText("Round 1 - Resilience");
    await expect(page.locator('#votePalette .vote-card.selected[data-vote="13"]')).toBeVisible();
    await expect(page.locator("#tableNotice")).toContainText("Room restored");
    await expect(page.locator("#connectionStatusText")).toContainText("Hosting 0 guest(s)");

    await page.locator("#leaveSessionBtn").click();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
    await expect(page.locator("#hostPlayerList")).toContainText("HostPersist");
});

test("host restored table notice resolves when known guest rejoins", async ({ page }) => {
    await openHome(page);
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, {
        v: 1,
        savedAt: Date.now(),
        role: "host",
        localId: "hostrestoreguest",
        displayName: "Host Restore Guest",
        currentView: "table",
        roomId: "room-restore-guest",
        selectedVote: null,
        hostApprovedGuestIds: ["guest-restore-1"],
        session: {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: {
                hostrestoreguest: {
                    id: "hostrestoreguest",
                    name: "Host Restore Guest",
                    connected: true,
                    vote: null,
                    isHost: true
                },
                "guest-restore-1": {
                    id: "guest-restore-1",
                    name: "Guest Restore",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        }
    });

    await page.reload();
    await expect(page.locator("#tableNotice")).toContainText("Room restored. Reopening guest auto-rejoin.");
    await expect(page.locator("#connectionStatusText")).toContainText("Hosting 0 guest(s)");

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { markHostRestoreRelayReady } = await import("/js/host-restore-status.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");

        state.hostRecoveryRelay = {
            readyState: "open",
            send() {},
            close() {}
        };
        markHostRestoreRelayReady();
        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", n: "Guest Restore", pin: "" }),
            "guest-restore-1",
            state.hostRecoveryRelay
        );
    });

    await expect(page.locator("#connectionStatusText")).toContainText("Hosting 1 guest(s)");
    await expect(page.locator("#tableNotice")).toContainText("Room restored. All known guests are back online.");
    await expect(page.locator("#tableNotice")).toBeHidden({ timeout: 5_000 });
    await expect(page.locator("#tableNotice")).toHaveText("");
});

test("host restored table notice changes to guidance when guests do not return", async ({ page }) => {
    await openHome(page);
    await setRuntimeOverrides(page, {
        __PP_TEST_HOST_RESTORE_WAIT_MS: 50
    });
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, {
        v: 1,
        savedAt: Date.now(),
        role: "host",
        localId: "hostrestorestalled",
        displayName: "Host Restore Stalled",
        currentView: "table",
        roomId: "room-restore-stalled",
        selectedVote: null,
        hostApprovedGuestIds: ["guest-stalled-1"],
        session: {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: {
                hostrestorestalled: {
                    id: "hostrestorestalled",
                    name: "Host Restore Stalled",
                    connected: true,
                    vote: null,
                    isHost: true
                },
                "guest-stalled-1": {
                    id: "guest-stalled-1",
                    name: "Guest Stalled",
                    connected: true,
                    vote: null,
                    isHost: false
                }
            }
        }
    });

    await page.reload();
    await expect(page.locator("#tableNotice")).toContainText(
        "1 guest has not rejoined yet. Share the room link or ask them to refresh."
    );
});

test("guest restored table shows reconnect journey after refresh", async ({ page }) => {
    await openHome(page);
    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");
        const { saveSessionSnapshot } = await import("/js/persistence.js");

        state.role = "guest";
        state.localId = "guestrestore01";
        state.displayName = "GuestRestore";
        state.selectedVote = "8";
        state.roomId = "room-restore";
        state.guestAutoRejoinEnabled = true;
        state.guestRemoteState = {
            round: 3,
            roundTitle: "Checkout Flow",
            started: true,
            revealed: false,
            players: [
                { id: "host-restore", name: "HostRestore", connected: false, isHost: true, voted: true, vote: null },
                { id: "guestrestore01", name: "GuestRestore", connected: false, isHost: false, voted: true, vote: null }
            ]
        };
        showView("table");
        renderTable();
        saveSessionSnapshot();
    });

    await page.reload();

    await expect(page.locator("#tableView.active")).toBeVisible();
    await expect(page.locator("#tableSubtitle")).toContainText("Round 3 - Checkout Flow");
    await expect(page.locator("#tableNotice")).toContainText(/Session restored|Trying to reconnect/);
    await expect(page.locator("#connectionStatusText")).toContainText(/Reconnecting|Disconnected|Reconnect pending approval/);
});

test("guest reconnect banner opens manual fallback from table", async ({ page }) => {
    await openHome(page);
    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");

        state.role = "guest";
        state.localId = "guestmanualfallback";
        state.displayName = "GuestManualFallback";
        state.roomId = "room-manual-fallback";
        state.guestConnectionPhase = "offline";
        state.guestAutoRejoinEnabled = true;
        state.guestRemoteState = {
            round: 1,
            roundTitle: "Manual fallback",
            started: true,
            revealed: false,
            players: [
                { id: "host-manual", name: "HostManual", connected: false, isHost: true, voted: false, vote: null },
                { id: "guestmanualfallback", name: "GuestManualFallback", connected: false, isHost: false, voted: false, vote: null }
            ]
        };
        showView("table");
        renderTable();
    });

    await expect(page.locator("#guestReconnectBanner")).toBeVisible();
    await expect(page.locator("#guestReconnectFallbackBtn")).toBeVisible();

    await page.locator("#guestReconnectFallbackBtn").click();

    await expect(page.locator("#guestConnectView.active")).toBeVisible();
    await expect(page.locator("#guestManualFallbackDetails")).toHaveJSProperty("open", true);
    await expect(page.locator("#guestConnectNotice")).toContainText(/Manual fallback ready|Generating join code/);
});

test("guest can still select a local vote while reconnect banner is visible", async ({ page }) => {
    await openHome(page);
    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");

        state.role = "guest";
        state.localId = "guestlocalvote";
        state.displayName = "GuestLocalVote";
        state.selectedVote = null;
        state.roomId = "room-local-vote";
        state.guestConnectionPhase = "offline";
        state.guestAutoRejoinEnabled = true;
        state.guestRemoteState = {
            round: 1,
            roundTitle: "Local vote",
            started: true,
            revealed: false,
            players: [
                { id: "host-local", name: "HostLocal", connected: false, isHost: true, voted: false, vote: null },
                { id: "guestlocalvote", name: "GuestLocalVote", connected: false, isHost: false, voted: false, vote: null }
            ]
        };
        showView("table");
        renderTable();
    });

    await expect(page.locator("#guestReconnectBanner")).toBeVisible();
    await expect(page.locator("#votePalette")).toHaveClass(/disabled/);

    await page.locator('#votePalette .vote-card[data-vote="5"]').click();

    await expect(page.locator('#votePalette .vote-card.selected[data-vote="5"]')).toBeVisible();
});

test("explicit leave clears session snapshot", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostClear");

    await page.locator("#hostBackHomeBtn").click();
    await expect(page.locator("#homeView.active")).toBeVisible();

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();
    await expect(page.locator("#hostLobbyView.active")).toHaveCount(0);
});

test("stale session snapshot is ignored on startup", async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => {
        const staleSnapshot = {
            v: 1,
            savedAt: Date.now() - (13 * 60 * 60 * 1000),
            role: "host",
            localId: "hoststale123",
            displayName: "Stale Host",
            currentView: "table",
            roomId: "hoststale123",
            selectedVote: "8",
            session: {
                round: 4,
                roundTitle: "Stale Round",
                started: true,
                revealed: false,
                players: {
                    hoststale123: {
                        id: "hoststale123",
                        name: "Stale Host",
                        connected: true,
                        vote: "8",
                        isHost: true
                    }
                }
            }
        };
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(staleSnapshot));
    });

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();
    await expect(page.locator("#tableView.active")).toHaveCount(0);
});

test("corrupt session snapshot is cleared and app boots safely", async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => {
        window.sessionStorage.setItem("planningPoker.session", "{not-json");
    });

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();

    const persisted = await page.evaluate(() => window.sessionStorage.getItem("planningPoker.session"));
    expect(persisted).toBeNull();
});

test("host can approve and reject unknown guest rejoin requests", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostApprove");

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { renderHostLobby } = await import("/js/render.js");
        const { showView } = await import("/js/ui.js");

        const sent = [];
        state.hostRecoveryRelay = {
            readyState: "open",
            send(data) {
                sent.push(JSON.parse(String(data)));
            },
            close() {}
        };
        state.hostPendingRejoinRequests = [
            { id: "guest-unknown-1", name: "Unknown One", requestedAt: Date.now() },
            { id: "guest-unknown-2", name: "Unknown Two", requestedAt: Date.now() }
        ];
        window.__rejoinSent = sent;
        showView("hostLobby");
        renderHostLobby();
    });

    await expect(page.getByTestId("banner-pending-rejoin")).toBeVisible();
    await expect(page.locator("#hostPendingRejoinList")).toContainText("Unknown One");
    await expect(page.locator("#hostPendingRejoinList")).toContainText("Unknown Two");

    await page.locator('[data-approve-rejoin="guest-unknown-1"]').click();
    await expect(page.locator("#hostPlayerList")).toContainText("Unknown One");

    await page.locator('[data-reject-rejoin="guest-unknown-2"]').click();
    await expect(page.locator("#hostPendingRejoinList")).not.toContainText("Unknown Two");

    const sentMessages = await page.evaluate(() => window.__rejoinSent || []);
    expect(sentMessages.some((msg) => msg.t === "rejoinAck" && msg.to === "guest-unknown-1")).toBe(true);
    expect(sentMessages.some((msg) => msg.t === "rejoinReject" && msg.to === "guest-unknown-2")).toBe(true);
});

test("guest table disconnect starts auto-rejoin loop", async ({ page }) => {
    await openHome(page);
    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        let websocketCreates = 0;

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                websocketCreates += 1;
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(_data) {
                // Keep relay session open without host ack.
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { onHostChannelClose } = await import("/js/guest.js");
            const { els, showView } = await import("/js/ui.js");
            const { renderTable } = await import("/js/render.js");

            state.role = "guest";
            state.displayName = "GuestAuto";
            state.roomId = "room-auto";
            state.guestAutoRejoinEnabled = true;
            state.guestRemoteState = {
                round: 2,
                roundTitle: "Auto Rejoin",
                started: true,
                revealed: false,
                players: []
            };
            showView("table");
            renderTable();

            const fakeChannel = {
                readyState: "open",
                close() {}
            };
            state.guestChannel = fakeChannel;
            onHostChannelClose(fakeChannel);
            await new Promise((resolve, reject) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    if (websocketCreates > 0) {
                        clearInterval(timer);
                        resolve();
                        return;
                    }
                    if (Date.now() - started > 8_000) {
                        clearInterval(timer);
                        reject(new Error("Auto-rejoin relay setup did not start in time."));
                    }
                }, 25);
            });

            return {
                websocketCreates,
                bannerHidden: !!els.guestReconnectBanner && els.guestReconnectBanner.hidden,
                bannerTitle: String(
                    els.guestReconnectBannerTitle ? els.guestReconnectBannerTitle.textContent || "" : ""
                ),
                status: String(els.connectionStatusText.textContent || "")
            };
        } finally {
            window.WebSocket = originalWebSocket;
        }
    });

    expect(result.websocketCreates).toBeGreaterThan(0);
    expect(result.bannerHidden).toBe(false);
    expect(result.bannerTitle).toMatch(/Reconnecting to host/);
    expect(result.status).toMatch(/Reconnecting|Disconnected/);
});
