const { test, expect } = require("@playwright/test");
const { openHome } = require("../helpers");
const {
    buildConnack,
    buildSuback,
    packet,
    encodeRemainingLength
} = require("../helpers/mocks/websocket");

function mockFunctionSources() {
    return {
        encodeRemainingLength: encodeRemainingLength.toString(),
        packet: packet.toString(),
        buildConnack: buildConnack.toString(),
        buildSuback: buildSuback.toString()
    };
}

test("mqtt guest inbound stall triggers recovery reconnect", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async ({ fnSources }) => {
        const makeFn = (source) => eval(`(${source})`);
        const buildConnack = makeFn(fnSources.buildConnack);
        const buildSuback = makeFn(fnSources.buildSuback);
        const originalWebSocket = window.WebSocket;
        const originalSetTimeout = window.setTimeout;
        window.__PP_TEST_MQTT_INBOUND_STALE_MS = 40;
        window.__PP_TEST_MQTT_HEALTH_CHECK_MS = 20;
        window.__PP_TEST_REJOIN_MAX_RETRIES = 2;
        const OPEN = 1;
        let websocketCreates = 0;
        window.setTimeout = (handler, timeout, ...args) => {
            const clamped = Math.min(Number(timeout || 0), 15);
            return originalSetTimeout(handler, clamped, ...args);
        };

        class ReceiveDeadWebSocket {
            static OPEN = OPEN;

            constructor() {
                websocketCreates += 1;
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                if (packetType === 1 && typeof this.onmessage === "function") {
                    this.onmessage({ data: buildConnack().buffer });
                    return;
                }
                if (packetType === 8 && typeof this.onmessage === "function") {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    this.onmessage({ data: buildSuback(packetIdMsb, packetIdLsb).buffer });
                    return;
                }
                // Ignore ping/publish so inbound goes stale while socket stays open.
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = ReceiveDeadWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { createMqttRelayChannel } = await import("/js/mqtt-relay.js");
            const { handleGuestInboundMessage, onHostChannelOpen } = await import("/js/guest.js");
            const { els, showView } = await import("/js/ui.js");
            const { renderTable } = await import("/js/render.js");

            state.role = "guest";
            state.displayName = "GuestMqttStale";
            state.roomId = "room-mqtt-stale";
            state.guestAutoRejoinEnabled = true;
            state.guestRemoteState = {
                round: 1,
                roundTitle: "",
                started: true,
                revealed: false,
                players: []
            };
            showView("table");
            renderTable();

            const relayChannel = createMqttRelayChannel("guest", state.roomId, state.localId, {
                onOpen: (channel) => {
                    state.guestChannel = channel;
                    onHostChannelOpen(channel);
                },
                onClose: () => {},
                onMessage: (payload) => {
                    handleGuestInboundMessage(payload, relayChannel);
                }
            });

            await new Promise((resolve) => setTimeout(resolve, 30));

            await new Promise((resolve) => setTimeout(resolve, 120));

            return {
                websocketCreates,
                phase: state.guestConnectionPhase,
                status: String(els.connectionStatusText.textContent || ""),
                revealApplied: !!(state.guestRemoteState && state.guestRemoteState.revealed),
                channelReadyState: state.guestChannel ? state.guestChannel.readyState : "none"
            };
        } finally {
            delete window.__PP_TEST_MQTT_INBOUND_STALE_MS;
            delete window.__PP_TEST_MQTT_HEALTH_CHECK_MS;
            delete window.__PP_TEST_REJOIN_MAX_RETRIES;
            window.WebSocket = originalWebSocket;
            window.setTimeout = originalSetTimeout;
        }
    }, { fnSources: mockFunctionSources() });

    expect(result.revealApplied).toBe(false);
    expect(result.websocketCreates).toBeGreaterThan(1);
    expect(result.status).toMatch(/unstable|Reconnecting|Disconnected/i);
});

test("guest fallback starts after first failed state without waiting for second failed event", async ({ page }) => {
    await openHome(page);
    const result = await page.evaluate(async ({ fnSources }) => {
        const makeFn = (source) => eval(`(${source})`);
        const encodeRemainingLength = makeFn(fnSources.encodeRemainingLength);
        const packet = makeFn(fnSources.packet);
        const buildConnack = makeFn(fnSources.buildConnack);
        const buildSuback = makeFn(fnSources.buildSuback);

        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        let websocketCreates = 0;
        let restartCalls = 0;

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                websocketCreates += 1;
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                if (packetType === 1 && typeof this.onmessage === "function") {
                    this.onmessage({ data: buildConnack().buffer });
                }
                if (packetType === 8 && typeof this.onmessage === "function") {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    this.onmessage({ data: buildSuback(packetIdMsb, packetIdLsb).buffer });
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { setupGuestPeerHandlers } = await import("/js/guest.js");
            const { els } = await import("/js/ui.js");

            state.role = "guest";
            state.currentView = "guestConnect";
            state.displayName = "GuestFallback";
            state.roomId = "room-fallback";
            state.selectedVote = null;

            const fakeDc = { send() {}, close() {} };
            const fakePc = {
                connectionState: "new",
                iceConnectionState: "new",
                restartIce() {
                    restartCalls += 1;
                }
            };

            state.guestChannel = fakeDc;
            state.guestPeer = fakePc;
            setupGuestPeerHandlers(fakePc, fakeDc);

            fakePc.connectionState = "failed";
            fakePc.onconnectionstatechange();

            await new Promise((resolve, reject) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    if (websocketCreates > 0 && restartCalls > 0) {
                        clearInterval(timer);
                        resolve();
                        return;
                    }
                    if (Date.now() - started > 8_000) {
                        clearInterval(timer);
                        reject(new Error("Guest fallback did not trigger relay setup in time."));
                    }
                }, 25);
            });
            return {
                websocketCreates,
                restartCalls,
                notice: els.guestConnectNotice.textContent || ""
            };
        } finally {
            window.WebSocket = originalWebSocket;
        }
    }, { fnSources: mockFunctionSources() });

    expect(result.restartCalls).toBe(1);
    expect(result.websocketCreates).toBeGreaterThan(0);
    expect(result.notice).not.toContain("Retrying ICE before relay fallback");
});

test("guest relay timeout shows terminal error notice", async ({ page }) => {
    test.setTimeout(35_000);
    await openHome(page);
    const noticeText = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;

        class TimeoutWebSocket {
            static OPEN = OPEN;

            constructor() {
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(_data) {
                // Intentionally never sends CONNACK/SUBACK to trigger timeout watchdog.
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = TimeoutWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { setupGuestPeerHandlers } = await import("/js/guest.js");
            const { els } = await import("/js/ui.js");

            state.role = "guest";
            state.currentView = "guestConnect";
            state.displayName = "GuestTimeout";
            state.roomId = "room-timeout";
            state.selectedVote = null;

            const fakeDc = { send() {}, close() {} };
            const fakePc = {
                connectionState: "new",
                iceConnectionState: "new",
                restartIce() {}
            };

            state.guestChannel = fakeDc;
            state.guestPeer = fakePc;
            setupGuestPeerHandlers(fakePc, fakeDc);

            fakePc.connectionState = "failed";
            fakePc.onconnectionstatechange();

            await new Promise((resolve, reject) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    const notice = String(els.guestConnectNotice.textContent || "");
                    if (notice.includes("Relay fallback failed")) {
                        clearInterval(timer);
                        resolve();
                        return;
                    }
                    if (Date.now() - started > 20_000) {
                        clearInterval(timer);
                        reject(new Error("Relay timeout notice did not appear in time."));
                    }
                }, 25);
            });
            return String(els.guestConnectNotice.textContent || "");
        } finally {
            window.WebSocket = originalWebSocket;
        }
    });

    expect(noticeText).toContain("Relay fallback failed (timeout)");
});

test("mqtt relay channel works with mocked websocket transport", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async ({ fnSources }) => {
        const makeFn = (source) => eval(`(${source})`);
        const encodeRemainingLength = makeFn(fnSources.encodeRemainingLength);
        const packet = makeFn(fnSources.packet);
        const buildConnack = makeFn(fnSources.buildConnack);
        const buildSuback = makeFn(fnSources.buildSuback);
        void encodeRemainingLength;
        void packet;
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        const sentPacketTypes = [];

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                this.onerror = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                sentPacketTypes.push(packetType);
                if (packetType === 1) {
                    if (typeof this.onmessage === "function") {
                        this.onmessage({ data: buildConnack().buffer });
                    }
                    return;
                }
                if (packetType === 8) {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    if (typeof this.onmessage === "function") {
                        this.onmessage({ data: buildSuback(packetIdMsb, packetIdLsb).buffer });
                    }
                    return;
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { createMqttRelayChannel } = await import("/js/mqtt-relay.js");
            const channel = createMqttRelayChannel("guest", "room-smoke", "guest-smoke", {
                onOpen: () => {},
                onMessage: () => {},
                onClose: () => {}
            });

            await new Promise((resolve, reject) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    if (sentPacketTypes.includes(1) && sentPacketTypes.includes(8)) {
                        clearInterval(timer);
                        resolve();
                        return;
                    }
                    if (Date.now() - started > 5000) {
                        clearInterval(timer);
                        reject(new Error("MQTT mock did not emit CONNECT and SUBSCRIBE packets in time."));
                    }
                }, 20);
            });

            channel.close();
            return {
                sawConnectPacket: sentPacketTypes.includes(1),
                sawSubscribePacket: sentPacketTypes.includes(8)
            };
        } finally {
            window.WebSocket = originalWebSocket;
        }
    }, { fnSources: mockFunctionSources() });

    expect(result.sawConnectPacket).toBe(true);
    expect(result.sawSubscribePacket).toBe(true);
});

test("host broadcast targets each guest explicitly", async ({ page }) => {
    await openHome(page);
    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { broadcastMessageToGuests } = await import("/js/host.js");

        const sent = [];
        const sharedRelay = {
            readyState: "open",
            transportType: "mqtt-relay",
            send(data) {
                sent.push(JSON.parse(String(data)));
            }
        };

        state.role = "host";
        state.localId = "host-routing";
        state.hostPeers.clear();
        state.hostPeers.set("guest-a", { id: "guest-a", dc: sharedRelay });
        state.hostPeers.set("guest-b", { id: "guest-b", dc: sharedRelay });

        broadcastMessageToGuests({ t: "state", round: 3 });
        return sent;
    });

    expect(result.some((msg) => msg.t === "state" && msg.to === "guest-a" && msg.round === 3)).toBe(true);
    expect(result.some((msg) => msg.t === "state" && msg.to === "guest-b" && msg.round === 3)).toBe(true);
});
