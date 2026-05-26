import { state } from "./state.js";
import { els, showNotice } from "./ui.js";
import { registerRuntimeCleanup } from "./runtime-cleanup.js";

const DEFAULT_RESTORE_WAIT_MS = 12_000;
const RESTORE_DONE_MS = 3_500;
const RESTORE_STALLED_MS = 8_000;

let restoreWaitTimer = null;

function getNoticeTarget() {
    return state.currentView === "table" ? els.tableNotice : els.hostLobbyNotice;
}

function clearRestoreTimer() {
    if (!restoreWaitTimer) return;
    clearTimeout(restoreWaitTimer);
    restoreWaitTimer = null;
}

function getExpectedGuestIds() {
    const status = state.hostRestoreStatus;
    return status && Array.isArray(status.expectedGuestIds) ? status.expectedGuestIds : [];
}

function getRemainingGuestIds() {
    if (!state.session || !state.session.players) return [];
    return getExpectedGuestIds().filter((guestId) => {
        const player = state.session.players[guestId];
        return player && !player.connected;
    });
}

function countLabel(count) {
    return count === 1 ? "1 guest" : count + " guests";
}

export function beginHostRestoreStatus() {
    if (state.role !== "host" || !state.session || !state.session.players) return;
    const expectedGuestIds = Object.keys(state.session.players)
        .filter((id) => id !== state.localId);

    state.hostRestoreStatus = {
        active: true,
        relayReady: !!(state.hostRecoveryRelay && state.hostRecoveryRelay.readyState === "open"),
        stalled: false,
        expectedGuestIds,
        startedAt: Date.now()
    };

    clearRestoreTimer();
    const testWaitMs = Number(window.__PP_TEST_HOST_RESTORE_WAIT_MS);
    const waitMs = Number.isFinite(testWaitMs) && testWaitMs >= 0
        ? Math.floor(testWaitMs)
        : DEFAULT_RESTORE_WAIT_MS;
    restoreWaitTimer = setTimeout(() => {
        const status = state.hostRestoreStatus;
        if (!status || !status.active) return;
        status.stalled = true;
        updateHostRestoreStatusNotice();
    }, waitMs);

    updateHostRestoreStatusNotice();
}

export function markHostRestoreRelayReady() {
    const status = state.hostRestoreStatus;
    if (!status || !status.active) return;
    status.relayReady = true;
    updateHostRestoreStatusNotice();
}

export function markHostRestoreRelayUnavailable() {
    const status = state.hostRestoreStatus;
    if (!status || !status.active) return;
    status.relayReady = false;
    updateHostRestoreStatusNotice();
}

export function updateHostRestoreStatusNotice() {
    const status = state.hostRestoreStatus;
    if (!status || !status.active) return;

    const target = getNoticeTarget();
    const remainingGuestIds = getRemainingGuestIds();
    if (!remainingGuestIds.length) {
        clearRestoreTimer();
        status.active = false;
        const hadGuests = getExpectedGuestIds().length > 0;
        showNotice(
            target,
            hadGuests
                ? "Room restored. All known guests are back online."
                : "Room restored.",
            "info",
            RESTORE_DONE_MS
        );
        return;
    }

    if (status.stalled) {
        clearRestoreTimer();
        status.active = false;
        const remainingCount = remainingGuestIds.length;
        showNotice(
            target,
            countLabel(remainingCount)
                + (remainingCount === 1 ? " has" : " have")
                + " not rejoined yet. Share the room link or ask them to refresh.",
            "warn",
            RESTORE_STALLED_MS
        );
        return;
    }

    if (!status.relayReady) {
        showNotice(
            target,
            "Room restored. Reopening guest auto-rejoin. Room code and manual join still work.",
            "info"
        );
        return;
    }

    showNotice(
        target,
        "Room restored. Waiting for " + countLabel(remainingGuestIds.length)
            + " to rejoin. Room code and manual join still work.",
        "info"
    );
}

export function clearHostRestoreStatus() {
    clearRestoreTimer();
    state.hostRestoreStatus = null;
}

export function getHostRestoreRuntimeDiagnosticsForTest() {
    return {
        restoreWaitTimer: !!restoreWaitTimer,
        restoreStatusActive: !!(state.hostRestoreStatus && state.hostRestoreStatus.active)
    };
}

registerRuntimeCleanup("host", clearHostRestoreStatus);
