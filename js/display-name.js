import { sanitizeText } from "./sanitize.js";
import { STORAGE_NAME_KEY } from "./state.js";

export const DISPLAY_NAME_MAX_LENGTH = 40;

export function sanitizeDisplayName(name) {
    return sanitizeText(name, DISPLAY_NAME_MAX_LENGTH);
}

export function persistDisplayName(name) {
    try {
        localStorage.setItem(STORAGE_NAME_KEY, name);
    } catch (_error) {
        // Storage can fail in private mode.
    }
}

export function loadPersistedDisplayName() {
    try {
        return sanitizeDisplayName(localStorage.getItem(STORAGE_NAME_KEY) || "");
    } catch (_error) {
        return "";
    }
}

/** Host roster or guest remote state — not an in-progress edit in the header field. */
export function getAuthoritativeDisplayName(appState) {
    if (appState.role === "host" && appState.session && appState.session.players[appState.localId]) {
        return sanitizeDisplayName(appState.session.players[appState.localId].name || appState.displayName);
    }
    if (appState.role === "guest" && appState.guestRemoteState) {
        const self = appState.guestRemoteState.players.find((player) => player.id === appState.localId);
        if (self && self.name) {
            return sanitizeDisplayName(self.name);
        }
    }
    return sanitizeDisplayName(appState.displayName || loadPersistedDisplayName() || "");
}

export function isInDisplayNameSession(appState) {
    return appState.role === "host" || appState.role === "guest";
}
