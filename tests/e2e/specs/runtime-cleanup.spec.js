const { test, expect } = require("@playwright/test");
const {
    getRuntimeDiagnostics,
    openHome,
    setRuntimeOverrides,
    withSessionPages
} = require("../helpers");

test("shutdownGuest clears guest timers and cancels delayed join-link entry", async ({ browser }) => {
    await withSessionPages(browser, ["guest"], async ({ guest }) => {
        await openHome(guest);

        const before = await guest.evaluate(async () => {
            const { state } = await import("/js/state.js");
            const { onHostChannelOpen } = await import("/js/guest.js");

            state.role = "guest";
            state.displayName = "GuestCleanup";
            state.roomId = "room-cleanup";
            state.guestAutoRejoinEnabled = true;
            state.guestJoinContext = "joinLink";
            state.guestJoinPhase = "connecting";
            state.guestRemoteState = {
                round: 1,
                roundTitle: "",
                started: true,
                revealed: false,
                players: []
            };

            const sent = [];
            const channel = {
                readyState: "open",
                transportType: "mqtt-relay",
                isInboundStale: () => false,
                syncReadyState() {},
                send(data) {
                    sent.push(String(data));
                },
                close() {
                    this.readyState = "closed";
                }
            };
            state.guestChannel = channel;
            onHostChannelOpen(channel);

            return window.__planningPokerTest.diagnostics();
        });

        expect(before.guest.joinLinkEnterTimer).toBe(true);

        await guest.evaluate(() => {
            window.__planningPokerTest.shutdownAll({ clearSnapshot: true });
        });
        await guest.waitForTimeout(650);

        const after = await getRuntimeDiagnostics(guest);
        expect(after.guest.rejoinTimer).toBe(false);
        expect(after.guest.disconnectedRecoveryTimer).toBe(false);
        expect(after.guest.mqttHealthTimer).toBe(false);
        expect(after.guest.presenceTimer).toBe(false);
        expect(after.guest.joinRetryTimer).toBe(false);
        expect(after.guest.joinLinkEnterTimer).toBe(false);
        expect(after.guest.rejoinAckTimerCount).toBe(0);
        expect(after.guest.relayFallbackTimerCount).toBe(0);
        await expect(guest.locator("#tableView.active")).toHaveCount(0);
    });
});

test("shutdownHost clears restore timers", async ({ browser }) => {
    await withSessionPages(browser, ["host"], async ({ host }) => {
        await openHome(host);

        await setRuntimeOverrides(host, {
            __PP_TEST_HOST_RESTORE_WAIT_MS: 10000
        });
        const before = await host.evaluate(async () => {
            const { state } = await import("/js/state.js");
            const { beginHostRestoreStatus } = await import("/js/host-restore-status.js");

            state.role = "host";
            state.localId = "host-cleanup";
            state.roomId = "room-cleanup";
            state.session = {
                round: 1,
                roundTitle: "",
                started: true,
                revealed: false,
                players: {
                    "host-cleanup": {
                        id: "host-cleanup",
                        name: "HostCleanup",
                        connected: true,
                        vote: null,
                        isHost: true
                    },
                    "guest-cleanup": {
                        id: "guest-cleanup",
                        name: "GuestCleanup",
                        connected: false,
                        vote: null,
                        isHost: false
                    }
                }
            };
            beginHostRestoreStatus();
            return window.__planningPokerTest.diagnostics();
        });

        expect(before.hostRestore.restoreWaitTimer).toBe(true);

        await host.evaluate(() => {
            window.__planningPokerTest.shutdownAll({ clearSnapshot: true });
        });

        const after = await getRuntimeDiagnostics(host);
        expect(after.hostRestore.restoreWaitTimer).toBe(false);
        expect(after.hostRestore.restoreStatusActive).toBe(false);
        expect(after.hostPeers.recoveryRetryTimer).toBe(false);
        expect(after.hostSignaling.relayFallbackTimerCount).toBe(0);
    });
});

test("shutdownHost does not reschedule recovery relay after closing it", async ({ browser }) => {
    await withSessionPages(browser, ["host"], async ({ host }) => {
        await openHome(host);
        await setRuntimeOverrides(host, {
            __PP_TEST_HOST_RECOVERY_RETRY_MS: 0
        });

        const after = await host.evaluate(async () => {
            const OriginalWebSocket = window.WebSocket;

            class OpenMqttWebSocket {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor(url) {
                    this.url = url;
                    this.readyState = OpenMqttWebSocket.CONNECTING;
                    this.binaryType = "";
                    setTimeout(() => {
                        this.readyState = OpenMqttWebSocket.OPEN;
                        if (typeof this.onopen === "function") this.onopen();
                    }, 0);
                }

                send(bytes) {
                    const packetType = bytes[0] >> 4;
                    if (packetType === 1) {
                        setTimeout(() => {
                            this.onmessage?.({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer });
                        }, 0);
                    }
                    if (packetType === 8) {
                        setTimeout(() => {
                            this.onmessage?.({ data: new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]).buffer });
                        }, 0);
                    }
                }

                close() {
                    this.readyState = OpenMqttWebSocket.CLOSED;
                    if (typeof this.onclose === "function") this.onclose();
                }
            }

            window.WebSocket = OpenMqttWebSocket;
            try {
                const { state } = await import("/js/state.js");
                const { startHostRecoveryRelayListener } = await import("/js/host.js");
                const { shutdownHost } = await import("/js/webrtc.js");

                state.role = "host";
                state.localId = "host-recovery-cleanup";
                state.roomId = "room-recovery-cleanup";
                state.session = {
                    round: 1,
                    roundTitle: "",
                    started: true,
                    revealed: false,
                    players: {
                        "host-recovery-cleanup": {
                            id: "host-recovery-cleanup",
                            name: "HostCleanup",
                            connected: true,
                            vote: null,
                            isHost: true
                        }
                    }
                };

                startHostRecoveryRelayListener();
                await new Promise((resolve, reject) => {
                    const deadline = Date.now() + 1000;
                    const check = () => {
                        if (state.hostRecoveryRelay?.readyState === "open") {
                            resolve();
                            return;
                        }
                        if (Date.now() > deadline) {
                            reject(new Error("Recovery relay did not open"));
                            return;
                        }
                        setTimeout(check, 10);
                    };
                    check();
                });

                shutdownHost();
                await new Promise((resolve) => setTimeout(resolve, 25));
                return window.__planningPokerTest.diagnostics();
            } finally {
                window.WebSocket = OriginalWebSocket;
            }
        });

        expect(after.hostPeers.recoveryRetryTimer).toBe(false);
        expect(after.hostPeers.recoveryRetryAttempts).toBe(0);
        expect(after.hostPeers.recoveryRelayReadyState).toBe("none");
    });
});

test("closing connecting MQTT relay transitions to closed and notifies once", async ({ browser }) => {
    await withSessionPages(browser, ["page"], async ({ page }) => {
        await openHome(page);

        const result = await page.evaluate(async () => {
            const OriginalWebSocket = window.WebSocket;
            class NeverOpenWebSocket {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor(url) {
                    this.url = url;
                    this.readyState = NeverOpenWebSocket.CONNECTING;
                    this.binaryType = "";
                }

                close() {
                    this.readyState = NeverOpenWebSocket.CLOSED;
                    if (typeof this.onclose === "function") {
                        this.onclose();
                    }
                }

                send() {}
            }

            window.WebSocket = NeverOpenWebSocket;
            try {
                const { createMqttRelayChannel } = await import("/js/mqtt-relay.js");
                let closeCount = 0;
                const channel = createMqttRelayChannel("guest", "room-close", "guest-close");
                channel.onclose = () => {
                    closeCount += 1;
                };
                channel.close();
                channel.close();
                return {
                    readyState: channel.readyState,
                    closeCount
                };
            } finally {
                window.WebSocket = OriginalWebSocket;
            }
        });

        expect(result.readyState).toBe("closed");
        expect(result.closeCount).toBe(1);
    });
});
