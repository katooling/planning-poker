import { state } from "./state.js";
import { decodeSignalCode } from "./signaling.js";
import { saveSessionSnapshot } from "./persistence.js";
import { createMqttRelayChannel } from "./mqtt-relay.js";
import { broadcastMessageToGuests, broadcastState } from "./host-session.js";
import {
    handleHostInboundMessage,
    onHostRecoveryRelayMessage,
    startHostRecoveryRelayListener
} from "./host-peers.js";
import { els, showView } from "./ui.js";
import { renderHostLobby, renderTable } from "./render.js";
import {
    ageGuestMqttInboundForTest,
    connectGuestByRoomCode,
    getGuestSessionDiagnosticsForTest,
    handleGuestInboundMessage,
    onHostChannelClose,
    onHostChannelOpen,
    runGuestMqttHealthCheckForTest,
    setupGuestPeerHandlers
} from "./guest.js";

/** @type {Record<string, unknown>} */
const e2eApi = {
    state,
    decodeSignalCode,
    saveSessionSnapshot,
    createMqttRelayChannel,
    broadcastMessageToGuests,
    broadcastState,
    handleHostInboundMessage,
    onHostRecoveryRelayMessage,
    startHostRecoveryRelayListener,
    els,
    showView,
    renderHostLobby,
    renderTable,
    ageGuestMqttInboundForTest,
    connectGuestByRoomCode,
    getGuestSessionDiagnosticsForTest,
    handleGuestInboundMessage,
    onHostChannelClose,
    onHostChannelOpen,
    runGuestMqttHealthCheckForTest,
    setupGuestPeerHandlers
};

export function installE2EBridge() {
    window.__planningPokerE2E = e2eApi;
}
