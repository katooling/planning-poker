import { state } from "./state.js";
import { shutdownGuest } from "./webrtc.js";
import { els, showNotice, showView } from "./ui.js";
import { renderConnectionStrategySections, renderJoinLinkHome } from "./render.js";
import { clearSessionSnapshot } from "./persistence.js";

export function getRoomCodeFromUrl() {
    try {
        const url = new URL(window.location.href);
        return String(url.searchParams.get("room") || "").trim();
    } catch (_error) {
        return "";
    }
}

export function shouldUseJoinLinkFlow() {
    if (state.connectionStrategy !== "mqttQuickJoin") return false;
    return !!getRoomCodeFromUrl();
}

export function isJoinLinkContext() {
    return state.guestJoinContext === "joinLink";
}

export function activateJoinLinkLanding() {
    const roomCode = getRoomCodeFromUrl();
    if (roomCode) {
        state.joinLinkRoomCode = roomCode;
        state.guestJoinContext = null;
        state.guestJoinPhase = "form";
        state.joinLinkSubtext = "";
    }
    renderJoinLinkHome();
    return !!roomCode;
}

export function setJoinLinkPhase(phase) {
    state.guestJoinPhase = phase || "form";
    renderJoinLinkHome();
}

export function readJoinLinkPin() {
    return String(els.joinLinkPinInput ? els.joinLinkPinInput.value : "").trim();
}

export function routeGuestJoinFeedback({
    message = "",
    type = "info",
    phase,
    subtext,
    escalate = false,
    focusPin = false
}) {
    if (escalate) {
        escalateToGuestConnect({ message, type, focusPin });
        return;
    }

    if (!isJoinLinkContext()) {
        showNotice(els.guestConnectNotice, message, type);
        return;
    }

    if (phase) {
        state.guestJoinPhase = phase;
    }
    if (subtext !== undefined) {
        state.joinLinkSubtext = subtext;
    }
    showNotice(els.joinLinkNotice, message, type);
    renderJoinLinkHome();
}

export function escalateToGuestConnect({ message, type = "warn", focusPin = false }) {
    state.guestJoinContext = "guestConnect";
    state.guestJoinPhase = "form";
    state.joinLinkSubtext = "";
    renderJoinLinkHome();

    if (els.guestRoomCodeInput && state.roomId) {
        els.guestRoomCodeInput.value = state.roomId;
    }
    if (els.guestRoomPinInput) {
        els.guestRoomPinInput.value = state.guestJoinPin || readJoinLinkPin();
    }

    showView("guestConnect");
    renderConnectionStrategySections();
    showNotice(els.guestConnectNotice, message, type);
    if (focusPin && els.guestRoomPinInput) {
        els.guestRoomPinInput.focus();
    }
}

export function cancelJoinLinkFlow() {
    shutdownGuest("Join canceled.");
    clearSessionSnapshot();
    state.guestJoinContext = null;
    state.guestJoinPhase = "form";
    state.joinLinkSubtext = "";
    state.role = "idle";
    state.roomId = null;
    renderJoinLinkHome();
    showView("home");
    showNotice(els.joinLinkNotice, "", "info");
}

export function getJoinLinkConnectParams() {
    const roomCode = String(state.joinLinkRoomCode || getRoomCodeFromUrl() || "").trim();
    if (!roomCode) {
        showNotice(els.homeNotice, "Room code is missing from the invite link.", "error");
        return null;
    }
    return {
        roomCode,
        pin: readJoinLinkPin()
    };
}

export function showJoinLinkConnectingUi() {
    renderJoinLinkHome();
    showView("home");
    routeGuestJoinFeedback({
        message: "Connecting to room…",
        type: "info",
        phase: "connecting"
    });
}

export function clearJoinLinkContext() {
    state.guestJoinContext = null;
    state.guestJoinPhase = "form";
    state.joinLinkSubtext = "";
    renderJoinLinkHome();
}
