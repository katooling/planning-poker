import { state } from "./state.js";

export function getGuestConnectionPresentation() {
    if (state.role !== "guest") {
        return { online: false, text: "Not connected", canSend: false };
    }
    if (state.guestConnectionPhase === "reconnecting") {
        return { online: false, text: "Reconnecting to host...", canSend: false };
    }
    const channel = state.guestChannel;
    if (channel && channel.readyState === "open") {
        if (
            channel.transportType === "mqtt-relay" &&
            typeof channel.isInboundStale === "function" &&
            channel.isInboundStale()
        ) {
            return {
                online: false,
                text: "Connection unstable — recovering...",
                canSend: false,
            };
        }
        if (state.guestConnectionPhase === "unstable") {
            return {
                online: false,
                text: "Connection unstable — recovering...",
                canSend: true,
            };
        }
        return { online: true, text: "Connected to host", canSend: true };
    }
    return { online: false, text: "Disconnected", canSend: false };
}

export function canGuestSendToHost() {
    return getGuestConnectionPresentation().canSend;
}
