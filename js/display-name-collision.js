export const DISPLAY_NAME_TAKEN_CODE = "displayNameTaken";
export const DISPLAY_NAME_TAKEN_REASON =
    "That name is already in use. Pick another name, or ask the host to remove the other guest first.";

export function isDisplayNameTaken(sessionState, guestId, guestName, sanitizeName) {
    if (!sessionState.session) return false;

    const joiningId = String(guestId || "").trim();
    const joiningName = sanitizeName(guestName);
    if (!joiningName) return false;

    const players = sessionState.session.players;
    if (players && typeof players === "object") {
        for (const [entryId, player] of Object.entries(players)) {
            if (!player || typeof player !== "object") continue;
            const playerId = String(player.id || entryId).trim();
            if (!playerId || playerId === joiningId) continue;
            if (!player.connected) continue;
            if (sanitizeName(player.name) === joiningName) return true;
        }
    }

    const pending = sessionState.hostPendingRejoinRequests;
    if (Array.isArray(pending)) {
        for (const entry of pending) {
            if (!entry || typeof entry !== "object") continue;
            const pendingId = String(entry.id || "").trim();
            if (!pendingId || pendingId === joiningId) continue;
            if (sanitizeName(entry.name) === joiningName) return true;
        }
    }

    return false;
}

export function sendDisplayNameTakenReject(sendJson, relayChannel, guestId) {
    sendJson(relayChannel, {
        t: "rejoinReject",
        to: guestId,
        code: DISPLAY_NAME_TAKEN_CODE,
        reason: DISPLAY_NAME_TAKEN_REASON
    });
}
