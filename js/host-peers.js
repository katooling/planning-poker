import { state } from "./state.js";
import { log } from "./log.js";
import { els, showNotice } from "./ui.js";
import { hostApplyVote, removeHostPlayer, upsertHostPlayer } from "./game.js";
import { renderHostLobby, renderTable } from "./render.js";
import { createMqttRelayChannel } from "./mqtt-relay.js";
import { saveSessionSnapshot } from "./persistence.js";
import { closePeerEntry } from "./webrtc.js";
import {
    DISPLAY_NAME_TAKEN_CODE,
    evaluateDisplayNameChange,
    isDisplayNameTaken,
    sendDisplayNameTakenReject
} from "./display-name-collision.js";
import { KICK_DISCONNECT_DELAY_MS, PENDING_REJOIN_MAX, sanitizeHostName } from "./host-shared.js";
import { broadcastState } from "./host-session.js";
import { sendJson } from "./messaging.js";
import {
    markHostRestoreRelayReady,
    markHostRestoreRelayUnavailable,
    updateHostRestoreStatusNotice
} from "./host-restore-status.js";
export { sendJson } from "./messaging.js";

const HOST_RECOVERY_RETRY_BASE_MS = 1000;
const HOST_RECOVERY_RETRY_MAX_MS = 8000;
let hostRecoveryRetryTimer = null;
let hostRecoveryRetryAttempts = 0;
let lastClosedRecoveryRelay = null;

function getHostRecoveryNoticeTarget() {
    return state.currentView === "table" ? els.tableNotice : els.hostLobbyNotice;
}

export function startHostRecoveryRelayListener() {
    if (state.role !== "host" || !state.session) return;
    const roomId = state.roomId || state.localId;
    if (!roomId) return;
    if (state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "open") return;
    if (state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "connecting") return;

    const relayChannel = createMqttRelayChannel("host", roomId, state.localId, {
        onOpen: (channel) => {
            clearHostRecoveryRetryTimer();
            hostRecoveryRetryAttempts = 0;
            const previousRecoveryRelay = lastClosedRecoveryRelay;
            state.hostRecoveryRelay = channel;
            rebindRelayPeersToRecoveryChannel(channel, previousRecoveryRelay);
            lastClosedRecoveryRelay = null;
            markHostRestoreRelayReady();
            log.info("host", "Host recovery relay ready", { roomId });
        },
        onClose: () => {
            if (state.hostRecoveryRelay !== relayChannel) return;
            lastClosedRecoveryRelay = relayChannel;
            state.hostRecoveryRelay = null;
            markHostRestoreRelayUnavailable();
            log.warn("host", "Host recovery relay closed", { roomId });
            scheduleHostRecoveryRelayRetry("channel-closed", true);
        },
        onMessage: (payload, fromGuestId) => {
            onHostRecoveryRelayMessage(payload, fromGuestId, relayChannel);
        },
        onFailure: (errorInfo) => {
            if (state.hostRecoveryRelay !== relayChannel) return;
            lastClosedRecoveryRelay = relayChannel;
            state.hostRecoveryRelay = null;
            const reason = errorInfo && errorInfo.reason ? errorInfo.reason : "unknown";
            markHostRestoreRelayUnavailable();
            log.warn("host", "Host recovery relay failed", { roomId, reason });
            scheduleHostRecoveryRelayRetry("failure-" + reason, true);
            if (state.currentView === "hostLobby") {
                showNotice(
                    els.hostLobbyNotice,
                    "Auto-reconnect listener failed (" + reason + "). Manual join code flow still works.",
                    "warn"
                );
            }
        }
    });
    state.hostRecoveryRelay = relayChannel;
}

export function approvePendingRejoin(guestId) {
    if (!state.session || state.role !== "host") return;
    const relayChannel = state.hostRecoveryRelay;
    if (!relayChannel || relayChannel.readyState !== "open") {
        showNotice(
            getHostRecoveryNoticeTarget(),
            "Recovery relay is not ready. Ask guest to retry shortly.",
            "warn"
        );
        return;
    }
    const pending = Array.isArray(state.hostPendingRejoinRequests)
        ? state.hostPendingRejoinRequests.find((entry) => entry.id === guestId)
        : null;
    if (!pending) return;

    attachRelayGuest(guestId, pending.name, relayChannel);
    sendJson(relayChannel, { t: "rejoinAck", to: guestId, room: state.roomId || state.localId });
    broadcastState();
    renderHostLobby();
    renderTable();
    updateHostRestoreStatusNotice();
}

export function rejectPendingRejoin(guestId) {
    if (state.role !== "host") return;
    clearPendingRejoin(guestId);
    const relayChannel = state.hostRecoveryRelay;
    if (relayChannel && relayChannel.readyState === "open") {
        sendJson(relayChannel, { t: "rejoinReject", to: guestId, reason: "Host approval required." });
    }
    renderHostLobby();
    renderTable();
    saveSessionSnapshot();
}

export function onKickGuest(guestId) {
    if (state.role !== "host" || !state.session) return;
    const normalizedGuestId = String(guestId || "").trim();
    if (!normalizedGuestId || normalizedGuestId === state.localId) return;

    const player = state.session.players[normalizedGuestId];
    const peer = state.hostPeers.get(normalizedGuestId);
    if (!player && !peer) return;
    forgetApprovedGuestId(normalizedGuestId);

    const guestName = sanitizeHostName((player && player.name) || (peer && peer.name) || "Guest");
    let delayedDisconnect = false;
    if (peer && peer.dc && peer.dc.readyState === "open") {
        sendJson(peer.dc, {
            t: "kicked",
            to: normalizedGuestId,
            reason: "Removed by host."
        });
        const kickedChannel = peer.dc;
        delayedDisconnect = true;
        setTimeout(() => {
            onPeerChannelClose(normalizedGuestId, kickedChannel);
        }, KICK_DISCONNECT_DELAY_MS);
    }

    if (peer && !delayedDisconnect) {
        onPeerChannelClose(normalizedGuestId, peer.dc);
    } else if (!peer) {
        removeHostPlayer(normalizedGuestId);
        clearPendingRejoin(normalizedGuestId);
        broadcastState();
        renderHostLobby();
        renderTable();
    }

    const noticeText = guestName + " was removed from the session.";
    if (state.currentView === "table") {
        showNotice(els.tableNotice, noticeText, "info", 1800);
    } else {
        showNotice(els.hostLobbyNotice, noticeText, "info", 1800);
    }
    log.info("host", "Guest kicked", { guestId: normalizedGuestId, guestName });
}

export function setupHostDataChannel(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;

    channel.onopen = () => {
        onPeerChannelOpen(guestId, channel);
        log.info("webrtc", "DataChannel opened", { role: "host", guestId, label: channel.label });
    };
    channel.onclose = () => {
        onPeerChannelClose(guestId, channel);
        log.warn("webrtc", "DataChannel closed", { role: "host", guestId, label: channel.label });
    };
    channel.onerror = () => {
        showNotice(els.hostLobbyNotice, "A peer data channel encountered an error.", "warn");
        log.warn("webrtc", "DataChannel error", { role: "host", guestId });
    };
    channel.onmessage = (event) => {
        onPeerChannelMessage(guestId, event.data, channel);
    };
}

export function onPeerChannelOpen(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (channel && entry.dc !== channel) return;
    markPeerConnected(guestId);
    broadcastState();
    renderHostLobby();
    renderTable();
}

export function onPeerTemporarilyDisconnected(guestId, transportType) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (transportType === "mqtt-relay") return;
    if (!entry.connected) return;
    entry.connected = false;
    upsertHostPlayer(guestId, entry.name, false, sanitizeHostName);
    broadcastState();
    renderHostLobby();
    renderTable();
}

export function channelTransportType(channel) {
    if (!channel || typeof channel !== "object") return "none";
    return channel.transportType || "webrtc";
}

export function onPeerChannelClose(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (channel && entry.dc !== channel) return;
    state.hostPeers.delete(guestId);
    removeHostPlayer(guestId);
    if (entry.dc === state.hostRecoveryRelay) {
        entry.dc = null;
    }
    closePeerEntry(entry);
    clearPendingRejoin(guestId);
    broadcastState();
    renderHostLobby();
    renderTable();
}

export function onPeerChannelMessage(guestId, rawData, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (channel && entry.dc !== channel) return;
    handleHostInboundMessage(guestId, rawData);
}

export function startHostRelayFallback(guestId) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    const roomId = state.roomId || state.localId;
    const relayChannel = createMqttRelayChannel("host", roomId, state.localId, {
        onOpen: (channel) => {
            entry.dc = channel;
            onPeerChannelOpen(guestId, channel);
            showNotice(els.hostLobbyNotice, "Relay fallback connected for " + entry.name + ".", "info");
        },
        onClose: () => {
            onPeerChannelClose(guestId, relayChannel);
        },
        onMessage: (payload, fromGuestId) => {
            if (fromGuestId !== guestId) return;
            onPeerChannelMessage(guestId, payload, relayChannel);
        },
        onFailure: (errorInfo) => {
            const reason = errorInfo && errorInfo.reason ? errorInfo.reason : "unknown";
            showNotice(
                els.hostLobbyNotice,
                "Relay fallback failed (" + reason + "). Ask " + entry.name + " to regenerate join code or try another network.",
                "error"
            );
        }
    });
    entry.dc = relayChannel;
}

export function handleHostInboundMessage(guestId, rawData) {
    if (!state.session) return;
    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;

    log.info("game", "Message received", { from: guestId, type: message.t || "unknown" });

    if (message.t === "name") {
        const peer = state.hostPeers.get(guestId);
        if (!applyGuestDisplayName(guestId, message.n, peer ? peer.dc : null)) {
            return;
        }
        broadcastState();
        renderHostLobby();
        renderTable();
        return;
    }

    if (message.t === "vote") {
        const vote = message.v == null ? null : String(message.v);
        const deps = { broadcastState, renderTable, renderHostLobby };
        hostApplyVote(guestId, vote, deps);
        return;
    }

    if (message.t === "presence") {
        const peer = state.hostPeers.get(guestId);
        const currentName = sanitizeHostName(getKnownGuestName(guestId));
        const requestedName = sanitizeHostName(message.n || currentName);
        let nextName = currentName;
        if (requestedName !== currentName) {
            const evaluation = evaluateDisplayNameChange(
                state,
                guestId,
                requestedName,
                sanitizeHostName,
                (_sessionState, id) => getKnownGuestName(id)
            );
            if (evaluation.ok) {
                nextName = evaluation.name;
            }
        }
        let changed = false;
        if (peer && peer.name !== nextName) {
            peer.name = nextName;
            changed = true;
        }
        const player = state.session.players[guestId];
        const wasConnected = !!(player && player.connected);
        const previousName = player ? player.name : null;
        upsertHostPlayer(guestId, nextName, true, sanitizeHostName);
        if (!wasConnected || previousName !== nextName) {
            changed = true;
        }
        // Always push state on presence so MQTT guests can resync after idle receive gaps.
        broadcastState();
        if (changed) {
            renderHostLobby();
            renderTable();
        }
        return;
    }

    if (message.t === "leave") {
        onPeerChannelClose(guestId);
    }
}

export function onHostRecoveryRelayMessage(rawData, fromGuestId, relayChannel) {
    const guestId = String(fromGuestId || "").trim();
    if (!guestId || guestId === state.localId) return;
    if (state.role !== "host" || !state.session) return;

    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;

    if (message.t === "rejoin") {
        const guestName = sanitizeHostName(message.n || "Guest");
        const guestPin = String(message.pin || "").trim();
        const roomPin = String(state.hostRoomPin || "").trim();
        if (roomPin && guestPin !== roomPin) {
            sendJson(relayChannel, { t: "rejoinReject", to: guestId, reason: "Invalid room PIN." });
            return;
        }

        if (isDisplayNameTaken(state, guestId, guestName, sanitizeHostName)) {
            sendDisplayNameTakenReject(sendJson, relayChannel, guestId);
            return;
        }

        if (isKnownGuestId(guestId) && state.hostAutoApproveKnownRejoin) {
            attachRelayGuest(guestId, guestName, relayChannel);
            sendJson(relayChannel, { t: "rejoinAck", to: guestId, room: state.roomId || state.localId });
            broadcastState();
            renderHostLobby();
            renderTable();
            updateHostRestoreStatusNotice();
            return;
        }
        if (!isKnownGuestId(guestId) && !state.hostRequireApprovalFirstJoin) {
            attachRelayGuest(guestId, guestName, relayChannel);
            sendJson(relayChannel, { t: "rejoinAck", to: guestId, room: state.roomId || state.localId });
            broadcastState();
            renderHostLobby();
            renderTable();
            updateHostRestoreStatusNotice();
            return;
        }
        queuePendingRejoin(guestId, guestName);
        renderHostLobby();
        renderTable();
        return;
    }

    if (!isKnownGuestId(guestId)) return;
    ensureRelayPeerEntry(guestId, relayChannel);
    markPeerConnected(guestId);
    handleHostInboundMessage(guestId, rawData);
}

function queuePendingRejoin(guestId, guestName) {
    if (!Array.isArray(state.hostPendingRejoinRequests)) {
        state.hostPendingRejoinRequests = [];
    }
    const existing = state.hostPendingRejoinRequests.find((entry) => entry.id === guestId);
    if (existing) {
        existing.name = guestName;
        existing.requestedAt = Date.now();
    } else {
        state.hostPendingRejoinRequests.push({
            id: guestId,
            name: guestName,
            requestedAt: Date.now()
        });
        if (state.hostPendingRejoinRequests.length > PENDING_REJOIN_MAX) {
            state.hostPendingRejoinRequests = state.hostPendingRejoinRequests
                .slice(-PENDING_REJOIN_MAX);
        }
    }
    if (state.currentView === "hostLobby") {
        showNotice(
            els.hostLobbyNotice,
            "Rejoin request from " + guestName + ". Approve or reject.",
            "info"
        );
        renderHostLobby();
    } else if (state.currentView === "table") {
        renderTable();
    }
    saveSessionSnapshot();
}

function ensureRelayPeerEntry(guestId, relayChannel) {
    const existing = state.hostPeers.get(guestId);
    if (existing && existing.dc && existing.dc !== relayChannel) {
        closePeerEntry(existing);
    }

    const current = state.hostPeers.get(guestId) || {
        id: guestId,
        name: getKnownGuestName(guestId),
        pc: null,
        dc: relayChannel,
        connected: false
    };
    current.id = guestId;
    current.name = sanitizeHostName(current.name || getKnownGuestName(guestId));
    current.pc = null;
    current.dc = relayChannel;
    state.hostPeers.set(guestId, current);
    return current;
}

function attachRelayGuest(guestId, guestName, relayChannel) {
    clearPendingRejoin(guestId);
    ensureRelayPeerEntry(guestId, relayChannel);
    const peer = state.hostPeers.get(guestId);
    peer.name = sanitizeHostName(guestName || peer.name || "Guest");
    markPeerConnected(guestId, peer.name);
    saveSessionSnapshot();
}

function markPeerConnected(guestId, preferredName) {
    const peer = state.hostPeers.get(guestId);
    if (!peer) return;
    peer.connected = true;
    rememberApprovedGuestId(guestId);
    const name = sanitizeHostName(preferredName || peer.name || getKnownGuestName(guestId));
    peer.name = name;
    upsertHostPlayer(guestId, name, true, sanitizeHostName);
}

function clearPendingRejoin(guestId) {
    if (!Array.isArray(state.hostPendingRejoinRequests) || !state.hostPendingRejoinRequests.length) {
        return;
    }
    state.hostPendingRejoinRequests = state.hostPendingRejoinRequests
        .filter((entry) => entry.id !== guestId);
}

function getKnownGuestName(guestId) {
    if (!state.session || !state.session.players || !state.session.players[guestId]) {
        return "Guest";
    }
    return state.session.players[guestId].name || "Guest";
}

function applyGuestDisplayName(guestId, rawName, replyChannel) {
    const evaluation = evaluateDisplayNameChange(
        state,
        guestId,
        rawName || "Guest",
        sanitizeHostName,
        (_sessionState, id) => getKnownGuestName(id)
    );
    if (!evaluation.ok) {
        if (evaluation.code === DISPLAY_NAME_TAKEN_CODE) {
            sendDisplayNameTakenReject(sendJson, replyChannel, guestId, { forRename: true });
        }
        return false;
    }
    if (evaluation.unchanged) {
        return true;
    }

    const peer = state.hostPeers.get(guestId);
    if (peer) peer.name = evaluation.name;
    upsertHostPlayer(guestId, evaluation.name, true, sanitizeHostName);
    return true;
}

function isKnownGuestId(guestId) {
    if (!state.session || !guestId || guestId === state.localId) return false;
    if (hasApprovedGuestId(guestId)) return true;
    return !!state.session.players && !!state.session.players[guestId];
}

function ensureApprovedGuestIdList() {
    if (!Array.isArray(state.hostApprovedGuestIds)) {
        state.hostApprovedGuestIds = [];
    }
    return state.hostApprovedGuestIds;
}

function hasApprovedGuestId(guestId) {
    return ensureApprovedGuestIdList().includes(guestId);
}

function rememberApprovedGuestId(guestId) {
    if (!guestId || guestId === state.localId) return;
    const approved = ensureApprovedGuestIdList();
    if (!approved.includes(guestId)) {
        approved.push(guestId);
    }
}

function forgetApprovedGuestId(guestId) {
    if (!guestId) return;
    const approved = ensureApprovedGuestIdList();
    if (!approved.length) return;
    state.hostApprovedGuestIds = approved.filter((id) => id !== guestId);
}

function clearHostRecoveryRetryTimer() {
    if (!hostRecoveryRetryTimer) return;
    clearTimeout(hostRecoveryRetryTimer);
    hostRecoveryRetryTimer = null;
}

function scheduleHostRecoveryRelayRetry(reason, immediate = false) {
    if (hostRecoveryRetryTimer) return;
    if (state.role !== "host" || !state.session) return;
    if (state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "open") return;
    if (state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "connecting") return;

    const baseDelay = Number(window.__PP_TEST_HOST_RECOVERY_RETRY_MS);
    const retryBaseMs = Number.isFinite(baseDelay) && baseDelay >= 0
        ? Math.floor(baseDelay)
        : HOST_RECOVERY_RETRY_BASE_MS;
    const delayMs = immediate
        ? 0
        : Math.min(
        retryBaseMs * (2 ** hostRecoveryRetryAttempts),
        HOST_RECOVERY_RETRY_MAX_MS
    );
    hostRecoveryRetryAttempts += 1;
    hostRecoveryRetryTimer = setTimeout(() => {
        hostRecoveryRetryTimer = null;
        if (state.role !== "host" || !state.session) return;
        startHostRecoveryRelayListener();
    }, delayMs);
    log.info("host", "Scheduling host recovery relay reconnect", {
        reason,
        attempt: hostRecoveryRetryAttempts,
        delayMs
    });
}

function rebindRelayPeersToRecoveryChannel(relayChannel, previousRecoveryRelay) {
    if (!relayChannel || relayChannel.readyState !== "open") return;
    if (!previousRecoveryRelay) return;
    let rebound = 0;
    for (const peer of state.hostPeers.values()) {
        if (!peer || !peer.dc) continue;
        if (peer.dc !== previousRecoveryRelay) continue;
        peer.dc = relayChannel;
        rebound += 1;
    }
    if (rebound) {
        broadcastState();
        renderHostLobby();
        renderTable();
        updateHostRestoreStatusNotice();
        log.info("host", "Rebound relay peers to recovery channel", { peers: rebound });
    }
}
