import { state } from "./state.js";
import { log } from "./log.js";
import {
    DEFAULT_STUN_SERVERS,
    formatIceServersForInput,
    loadUserIceServers,
    parseIceServerInput,
    saveUserIceServers
} from "./ice-config.js";
import {
    copyTextWithFeedback,
    els,
    flagDisplayNameInputError,
    formatSignalCodeForDisplay,
    setGuestStep,
    setSignalCodeDisplay,
    setTableViewHandler,
    showNotice,
    showView,
    updateConnectionStatus
} from "./ui.js";
import { getActiveStrategy } from "./connection-strategies/index.js";
import { loadConnectionSettings, saveConnectionSettings } from "./connection-settings.js";
import {
    renderConnectionStrategySections,
    renderHostLobby,
    renderTable,
    renderVotePalette,
    setVoteSelectHandler
} from "./render.js";
import {
    activateJoinLinkLanding,
    cancelJoinLinkFlow,
    getJoinLinkConnectParams,
    shouldUseJoinLinkFlow,
    showJoinLinkConnectingUi
} from "./join-link.js";
import { setLocalVote } from "./game.js";
import {
    applyHostDisplayNameRename,
    configureHost,
    broadcastState,
    onAcceptGuestCode,
    onKickGuest,
    onHostNewRound,
    onHostRoundTitleChange,
    onHostRevealVotes,
    onHostStartGame,
    approvePendingRejoin,
    getHostPeerRuntimeDiagnosticsForTest,
    getHostSignalingRuntimeDiagnosticsForTest,
    rejectPendingRejoin,
    startHostRecoveryRelayListener,
    startHostSession
} from "./host.js";
import { canGuestSendToHost } from "./guest-connection-status.js";
import {
    onGuestConnectWithResponseCode,
    connectGuestByRoomCode,
    getGuestRuntimeDiagnosticsForTest,
    notifyGuestLeaving,
    onRegenerateGuestOffer,
    sendJson as guestSendJson,
    startGuestSession,
    stopGuestAutoRejoin,
    submitGuestDisplayNameRename,
    triggerGuestAutoRejoin
} from "./guest.js";
import { shutdownGuest, shutdownHost } from "./webrtc.js";
import { clearSessionSnapshot, loadSessionSnapshot, saveSessionSnapshot } from "./persistence.js";
import { EMPTY_GUEST_JOIN_CODE_DISPLAY, EMPTY_HOST_RESPONSE_CODE_DISPLAY } from "./signal-display-presets.js";
import { sanitizeText } from "./sanitize.js";
import { DISPLAY_NAME_TAKEN_REASON } from "./display-name-collision.js";
import {
    beginHostRestoreStatus,
    clearHostRestoreStatus,
    getHostRestoreRuntimeDiagnosticsForTest
} from "./host-restore-status.js";
import { getRuntimeCleanupDiagnosticsForTest } from "./runtime-cleanup.js";
import {
    getAuthoritativeDisplayName,
    isInDisplayNameSession,
    loadPersistedDisplayName,
    persistDisplayName,
    sanitizeDisplayName
} from "./display-name.js";

init();

function init() {
    const connectionSettings = loadConnectionSettings();
    state.connectionStrategy = connectionSettings.strategy;
    state.hostRequireApprovalFirstJoin = connectionSettings.hostRequireApprovalFirstJoin;
    state.hostAutoApproveKnownRejoin = connectionSettings.hostAutoApproveKnownRejoin;
    state.displayName = loadPersistedDisplayName();
    els.displayNameInput.value = state.displayName;
    configureHost({ sanitizeName });
    setTableViewHandler(renderTable);
    setVoteSelectHandler((vote) => {
        setLocalVote(vote, createVoteDeps());
    });

    renderVotePalette();
    renderConnectionStrategySections();
    wireEvents();

    els.copyGuestJoinCodeBtn.disabled = true;
    els.copyGuestJoinCodeFormattedBtn.disabled = true;
    els.copyHostResponseCodeBtn.disabled = true;
    els.copyHostResponseCodeFormattedBtn.disabled = true;

    setSignalCodeDisplay(
        els.guestJoinCode,
        els.guestJoinCodeMeta,
        els.guestJoinCodeQuality,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.rawCode,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyText,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyMetaText,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyQualityText
    );
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.rawCode,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyText,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyMetaText,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyQualityText
    );

    const restored = restoreSessionFromSnapshot(loadSessionSnapshot());
    if (!restored) {
        updateConnectionStatus(false, "Not connected");
        activateJoinLinkLanding();
        showView("home");
    }
    window.planningPokerLog = log;
    installTestHooks();
    log.info("init", "Application initialized", {
        restoredName: state.displayName || null,
        restoredSession: restored ? state.role : null
    });
}

function installTestHooks() {
    if (!window.__PP_TEST_MODE) return;
    window.__planningPokerTest = {
        async shutdownAll(options = {}) {
            if (state.role === "guest") {
                await notifyGuestLeaving({ waitForFlush: true });
            }
            shutdownGuest();
            shutdownHost();
            if (options && options.clearSnapshot) {
                clearSessionSnapshot();
            }
        },
        diagnostics() {
            return {
                role: state.role,
                currentView: state.currentView,
                roomId: state.roomId,
                guest: getGuestRuntimeDiagnosticsForTest(),
                hostPeers: getHostPeerRuntimeDiagnosticsForTest(),
                hostSignaling: getHostSignalingRuntimeDiagnosticsForTest(),
                hostRestore: getHostRestoreRuntimeDiagnosticsForTest(),
                runtimeCleanup: getRuntimeCleanupDiagnosticsForTest()
            };
        }
    };
}

function wireEvents() {
    wireHostEvents();
    wireGuestEvents();
    wireTableEvents();
    wireProfileAndLifecycleEvents();
    wireSettingsEvents();
    wireKeyboardEvents();
}

function wireHostEvents() {
    els.createRoomBtn.addEventListener("click", onCreateRoom);
    els.acceptGuestBtn.addEventListener("click", onAcceptGuestCode);
    els.clearHostJoinCodeBtn.addEventListener("click", () => {
        els.hostIncomingJoinCode.value = "";
    });
    if (els.hostPlayerList) {
        els.hostPlayerList.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const guestId = target.getAttribute("data-kick-player");
            if (!guestId) return;
            onKickGuest(guestId);
        });
    }
    const wirePendingRejoinList = (listEl) => {
        if (!listEl) return;
        listEl.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const approveId = target.getAttribute("data-approve-rejoin");
            if (approveId) {
                approvePendingRejoin(approveId);
                return;
            }
            const rejectId = target.getAttribute("data-reject-rejoin");
            if (rejectId) {
                rejectPendingRejoin(rejectId);
            }
        });
    };
    wirePendingRejoinList(els.hostPendingRejoinList);
    wirePendingRejoinList(els.tablePendingRejoinList);
    els.copyHostResponseCodeBtn.addEventListener("click", async () => {
        await copyTextWithFeedback(state.hostResponseCodeRaw, els.copyHostResponseCodeBtn, "Copied");
    });
    els.copyHostResponseCodeFormattedBtn.addEventListener("click", async () => {
        const formatted = formatSignalCodeForDisplay(state.hostResponseCodeRaw);
        await copyTextWithFeedback(formatted, els.copyHostResponseCodeFormattedBtn, "Copied");
    });
    els.hostStartGameBtn.addEventListener("click", onHostStartGame);
    els.hostBackHomeBtn.addEventListener("click", () => {
        shutdownHost("Session closed.");
        clearSessionSnapshot();
        showView("home");
    });
    if (els.copyHostRoomCodeBtn) {
        els.copyHostRoomCodeBtn.addEventListener("click", async () => {
            await copyTextWithFeedback(String(state.roomId || state.localId || ""), els.copyHostRoomCodeBtn, "Copied");
        });
    }
    if (els.copyHostJoinLinkBtn) {
        els.copyHostJoinLinkBtn.addEventListener("click", async () => {
            const roomCode = String(state.roomId || state.localId || "");
            const joinUrl = roomCode
                ? (window.location.origin + window.location.pathname + "?room=" + encodeURIComponent(roomCode))
                : "";
            await copyTextWithFeedback(joinUrl, els.copyHostJoinLinkBtn, "Copied");
        });
    }
    if (els.hostRoomPinInput) {
        els.hostRoomPinInput.addEventListener("input", () => {
            state.hostRoomPin = String(els.hostRoomPinInput.value || "").trim().slice(0, 20);
            saveSessionSnapshot();
        });
    }
}

function wireGuestEvents() {
    els.joinRoomBtn.addEventListener("click", onJoinRoom);
    if (els.joinLinkCancelBtn) {
        els.joinLinkCancelBtn.addEventListener("click", cancelJoinLinkFlow);
    }
    if (els.connectGuestRoomBtn) {
        els.connectGuestRoomBtn.addEventListener("click", () => {
            const activeStrategy = getActiveStrategy();
            if (activeStrategy && typeof activeStrategy.connectGuestPrimary === "function") {
                activeStrategy.connectGuestPrimary();
                return;
            }
            connectGuestByRoomCode(
                els.guestRoomCodeInput ? els.guestRoomCodeInput.value : "",
                els.guestRoomPinInput ? els.guestRoomPinInput.value : ""
            );
        });
    }
    els.copyGuestJoinCodeBtn.addEventListener("click", async () => {
        await copyTextWithFeedback(state.guestJoinCodeRaw, els.copyGuestJoinCodeBtn, "Copied");
    });
    els.copyGuestJoinCodeFormattedBtn.addEventListener("click", async () => {
        const formatted = formatSignalCodeForDisplay(state.guestJoinCodeRaw);
        await copyTextWithFeedback(formatted, els.copyGuestJoinCodeFormattedBtn, "Copied");
    });
    els.regenerateGuestJoinCodeBtn.addEventListener("click", onRegenerateGuestOffer);
    els.connectGuestBtn.addEventListener("click", onGuestConnectWithResponseCode);
    els.guestBackHomeBtn.addEventListener("click", () => {
        shutdownGuest("Join canceled.");
        clearSessionSnapshot();
        activateJoinLinkLanding();
        showView("home");
    });
}

function wireTableEvents() {
    els.leaveSessionBtn.addEventListener("click", onLeaveOrBack);
    els.clearVoteBtn.addEventListener("click", () => {
        setLocalVote(null, createVoteDeps());
    });
    els.hostRevealBtn.addEventListener("click", onHostRevealVotes);
    els.hostResetBtn.addEventListener("click", onHostNewRound);
    els.hostRoundTitleInput.addEventListener("input", () => {
        onHostRoundTitleChange(els.hostRoundTitleInput.value);
    });
    if (els.guestReconnectRetryBtn) {
        els.guestReconnectRetryBtn.addEventListener("click", () => {
            triggerGuestAutoRejoin("manual-banner-retry");
        });
    }
    if (els.guestReconnectFallbackBtn) {
        els.guestReconnectFallbackBtn.addEventListener("click", () => {
            openGuestManualFallbackReconnect();
        });
    }
}

function createVoteDeps() {
    return {
        els,
        renderVotePalette,
        showNotice,
        sendJson: guestSendJson,
        broadcastState,
        renderTable,
        renderHostLobby
    };
}

function wireProfileAndLifecycleEvents() {
    els.displayNameInput.addEventListener("input", () => {
        if (isInDisplayNameSession(state)) return;
        state.displayName = sanitizeName(els.displayNameInput.value);
        persistDisplayName(state.displayName);
        saveSessionSnapshot();
    });
    els.displayNameInput.addEventListener("change", () => {
        commitDisplayNameChange();
    });
    window.addEventListener("pagehide", onPageHide);
}

function commitDisplayNameChange() {
    const name = sanitizeName(els.displayNameInput.value || "");
    if (!name) {
        restoreDisplayNameField();
        showDisplayNameNotice("Please enter your display name.", "warn");
        els.displayNameInput.focus();
        return;
    }

    state.displayName = name;
    els.displayNameInput.value = name;

    if (state.role === "host" && state.session) {
        const result = applyHostDisplayNameRename(name);
        if (!result.applied) {
            restoreDisplayNameField();
            showDisplayNameNotice(result.reason || DISPLAY_NAME_TAKEN_REASON, "error");
            flagDisplayNameInputError();
            return;
        }
        return;
    }

    if (state.role === "guest" && canGuestSendToHost()) {
        const result = submitGuestDisplayNameRename(name);
        if (result.reason === "empty") {
            restoreDisplayNameField();
            showDisplayNameNotice("Please enter your display name.", "warn");
            return;
        }
        return;
    }

    persistDisplayName(name);
    saveSessionSnapshot();
}

function restoreDisplayNameField() {
    const fallback = getAuthoritativeDisplayName(state);
    els.displayNameInput.value = fallback;
    state.displayName = fallback;
    persistDisplayName(fallback);
}

function showDisplayNameNotice(text, type, timeoutMs) {
    if (state.currentView === "table") {
        showNotice(els.tableNotice, text, type, timeoutMs);
        return;
    }
    if (state.currentView === "hostLobby") {
        showNotice(els.hostLobbyNotice, text, type, timeoutMs);
        return;
    }
    if (state.currentView === "guestConnect") {
        showNotice(els.guestConnectNotice, text, type, timeoutMs);
        return;
    }
    if (state.guestJoinContext === "joinLink") {
        showNotice(els.joinLinkNotice, text, type, timeoutMs);
        return;
    }
    showNotice(els.homeNotice, text, type, timeoutMs);
}

function wireSettingsEvents() {
    if (els.iceSettingsBtn) {
        els.iceSettingsBtn.addEventListener("click", openIceSettingsDialog);
    }
    if (els.iceSettingsCancelBtn) {
        els.iceSettingsCancelBtn.addEventListener("click", () => {
            if (els.iceSettingsDialog && els.iceSettingsDialog.open) {
                els.iceSettingsDialog.close();
            }
        });
    }
    if (els.iceSettingsSaveBtn) {
        els.iceSettingsSaveBtn.addEventListener("click", onSaveIceSettings);
    }
    if (els.iceSettingsDialog) {
        els.iceSettingsDialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            els.iceSettingsDialog.close();
        });
    }
}

function wireKeyboardEvents() {
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            if (state.currentView === "home"
                && state.guestJoinContext === "joinLink"
                && state.guestJoinPhase !== "form") {
                cancelJoinLinkFlow();
                return;
            }
            if (state.currentView === "guestConnect") {
                shutdownGuest("Join canceled.");
                clearSessionSnapshot();
                activateJoinLinkLanding();
                showView("home");
                return;
            }
            if (state.currentView === "hostLobby") {
                shutdownHost("Session closed.");
                clearSessionSnapshot();
                showView("home");
                return;
            }
            if (state.currentView === "table" && state.role === "guest") {
                onLeaveOrBack();
            }
        }

        if (event.key === "Enter" && !event.shiftKey) {
            if (document.activeElement === els.hostIncomingJoinCode) {
                event.preventDefault();
                onAcceptGuestCode();
            }
            if (document.activeElement === els.guestResponseCodeInput) {
                event.preventDefault();
                onGuestConnectWithResponseCode();
            }
            if (document.activeElement === els.guestRoomCodeInput) {
                event.preventDefault();
                connectGuestByRoomCode(
                    els.guestRoomCodeInput ? els.guestRoomCodeInput.value : "",
                    els.guestRoomPinInput ? els.guestRoomPinInput.value : ""
                );
            }
        }
    });
}

function openIceSettingsDialog() {
    if (!els.iceSettingsDialog || typeof els.iceSettingsDialog.showModal !== "function") {
        showNotice(els.homeNotice, "Connection settings are not supported in this browser.", "warn");
        return;
    }
    const defaultLines = DEFAULT_STUN_SERVERS
        .map((server) => Array.isArray(server.urls) ? server.urls.join(", ") : server.urls)
        .join("\n");
    els.defaultIceServersList.textContent = defaultLines;
    els.customIceServersInput.value = formatIceServersForInput(loadUserIceServers());
    const savedConnectionSettings = loadConnectionSettings();
    if (els.connectionStrategySelect) {
        els.connectionStrategySelect.value = savedConnectionSettings.strategy;
    }
    if (els.hostRequireApprovalFirstJoinCheckbox) {
        els.hostRequireApprovalFirstJoinCheckbox.checked = savedConnectionSettings.hostRequireApprovalFirstJoin;
    }
    if (els.hostAutoApproveKnownRejoinCheckbox) {
        els.hostAutoApproveKnownRejoinCheckbox.checked = savedConnectionSettings.hostAutoApproveKnownRejoin;
    }
    showNotice(els.iceSettingsNotice, "", "info");
    els.iceSettingsDialog.showModal();
}

function onSaveIceSettings() {
    const parsedServers = parseIceServerInput(els.customIceServersInput.value);
    saveUserIceServers(parsedServers);
    const savedConnectionSettings = saveConnectionSettings({
        strategy: els.connectionStrategySelect ? els.connectionStrategySelect.value : state.connectionStrategy,
        hostRequireApprovalFirstJoin: els.hostRequireApprovalFirstJoinCheckbox
            ? !!els.hostRequireApprovalFirstJoinCheckbox.checked
            : state.hostRequireApprovalFirstJoin,
        hostAutoApproveKnownRejoin: els.hostAutoApproveKnownRejoinCheckbox
            ? !!els.hostAutoApproveKnownRejoinCheckbox.checked
            : state.hostAutoApproveKnownRejoin
    });
    state.connectionStrategy = savedConnectionSettings.strategy;
    state.hostRequireApprovalFirstJoin = savedConnectionSettings.hostRequireApprovalFirstJoin;
    state.hostAutoApproveKnownRejoin = savedConnectionSettings.hostAutoApproveKnownRejoin;
    renderConnectionStrategySections();
    if (els.iceSettingsDialog.open) {
        els.iceSettingsDialog.close();
    }
    showNotice(getCurrentNoticeElement(), "Connection settings saved.", "info");
}

function getCurrentNoticeElement() {
    if (state.currentView === "hostLobby") return els.hostLobbyNotice;
    if (state.currentView === "guestConnect") return els.guestConnectNotice;
    if (state.currentView === "table") return els.tableNotice;
    if (state.currentView === "home" && state.guestJoinContext === "joinLink") return els.joinLinkNotice;
    return els.homeNotice;
}

function onCreateRoom() {
    const name = ensureDisplayName();
    if (!name) return;
    const activeStrategy = getActiveStrategy();
    if (activeStrategy && typeof activeStrategy.startHost === "function") {
        activeStrategy.startHost(name);
        return;
    }
    startHostSession(name);
}

function onJoinRoom() {
    const name = ensureDisplayName();
    if (!name) return;
    const activeStrategy = getActiveStrategy();
    if (activeStrategy && typeof activeStrategy.startGuest === "function") {
        if (shouldUseJoinLinkFlow()) {
            const connect = getJoinLinkConnectParams();
            if (!connect) return;
            activeStrategy.startGuest(name, {
                forJoinLink: true,
                roomCode: connect.roomCode,
                pin: connect.pin
            });
            showJoinLinkConnectingUi();
            void connectGuestByRoomCode(connect.roomCode, connect.pin, { source: "joinLink" });
            return;
        }
        activeStrategy.startGuest(name);
        renderConnectionStrategySections();
        return;
    }
    startGuestSession(name);
}

async function onLeaveOrBack() {
    if (state.role === "host") {
        if (state.currentView === "table") {
            showView("hostLobby");
            renderHostLobby();
            saveSessionSnapshot();
            return;
        }
        shutdownHost("Session closed.");
        clearSessionSnapshot();
        showView("home");
        return;
    }

    if (state.currentView === "table" && !isGuestConnected()) {
        showView("guestConnect");
        setGuestStep(1);
        renderConnectionStrategySections();
        state.guestAutoRejoinEnabled = true;
        if (state.connectionStrategy === "manualWebRtc") {
            showNotice(els.guestConnectNotice, "Session restored. Share a fresh join code with host to reconnect.", "info");
            void onRegenerateGuestOffer();
        } else {
            if (els.guestRoomCodeInput && state.roomId) {
                els.guestRoomCodeInput.value = state.roomId;
            }
            showNotice(els.guestConnectNotice, "Session restored. Retrying relay reconnect...", "info");
            triggerGuestAutoRejoin("reconnect-button");
        }
        saveSessionSnapshot();
        return;
    }

    state.guestAutoRejoinEnabled = false;
    await notifyGuestLeaving({ waitForFlush: true });
    shutdownGuest("Disconnected.");
    clearSessionSnapshot();
    showView("home");
}

function onPageHide() {
    saveSessionSnapshot();
    if (state.role === "guest") {
        notifyGuestLeaving();
        shutdownGuest();
        return;
    }
    if (state.role === "host") {
        shutdownHost();
    }
}

function ensureDisplayName() {
    const name = sanitizeName(els.displayNameInput.value || "");
    if (!name) {
        showNotice(els.homeNotice, "Please enter your display name.", "warn");
        els.displayNameInput.focus();
        return "";
    }
    state.displayName = name;
    persistDisplayName(name);
    els.displayNameInput.value = name;
    return name;
}

function restoreSessionFromSnapshot(snapshot) {
    if (!snapshot) return false;

    state.localId = snapshot.localId;
    state.connectionStrategy = snapshot.connectionStrategy === "manualWebRtc" ? "manualWebRtc" : state.connectionStrategy;
    state.hostRequireApprovalFirstJoin = snapshot.hostRequireApprovalFirstJoin !== false;
    state.hostAutoApproveKnownRejoin = snapshot.hostAutoApproveKnownRejoin !== false;
    if (snapshot.displayName) {
        state.displayName = snapshot.displayName;
        els.displayNameInput.value = snapshot.displayName;
    }

    if (snapshot.role === "host") {
        restoreHostSnapshot(snapshot);
        return true;
    }
    if (snapshot.role === "guest") {
        restoreGuestSnapshot(snapshot);
        return true;
    }
    return false;
}

function restoreHostSnapshot(snapshot) {
    state.role = "host";
    state.selectedVote = snapshot.selectedVote;
    state.roomId = snapshot.roomId || snapshot.localId;
    state.session = snapshot.session;
    state.hostPeers.clear();
    state.hostResponseCodeRaw = "";
    state.hostRoomPin = snapshot.hostRoomPin || "";
    clearHostRestoreStatus();
    state.hostApprovedGuestIds = Array.isArray(snapshot.hostApprovedGuestIds)
        ? snapshot.hostApprovedGuestIds.slice()
        : [];
    state.hostPendingRejoinRequests = Array.isArray(snapshot.hostPendingRejoinRequests)
        ? snapshot.hostPendingRejoinRequests.map((entry) => ({ ...entry }))
        : [];
    state.guestPeer = null;
    state.guestChannel = null;
    state.guestRemoteState = null;
    state.guestJoinCodeRaw = "";
    state.guestResponseApplied = false;
    els.hostIncomingJoinCode.value = "";
    els.copyHostResponseCodeBtn.disabled = true;
    els.copyHostResponseCodeFormattedBtn.disabled = true;
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.rawCode,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyText,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyMetaText,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyQualityText
    );
    renderHostLobby();
    startHostRecoveryRelayListener();

    if (snapshot.currentView === "table") {
        showView("table");
        renderTable();
        beginHostRestoreStatus();
    } else {
        showView("hostLobby");
        beginHostRestoreStatus();
    }
    saveSessionSnapshot();
}

function restoreGuestSnapshot(snapshot) {
    state.role = "guest";
    state.selectedVote = snapshot.selectedVote;
    state.roomId = snapshot.roomId || null;
    state.guestRemoteState = snapshot.guestRemoteState;
    state.guestPeer = null;
    state.guestChannel = null;
    state.guestJoinCodeRaw = "";
    state.guestResponseApplied = false;
    state.guestAutoRejoinEnabled = true;
    state.session = null;
    state.hostPeers.clear();
    state.hostResponseCodeRaw = "";
    setGuestStep(1);
    els.guestResponseCodeInput.value = "";
    els.copyGuestJoinCodeBtn.disabled = true;
    els.copyGuestJoinCodeFormattedBtn.disabled = true;
    els.connectGuestBtn.disabled = false;
    setSignalCodeDisplay(
        els.guestJoinCode,
        els.guestJoinCodeMeta,
        els.guestJoinCodeQuality,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.rawCode,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyText,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyMetaText,
        EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyQualityText
    );
    state.guestConnectionPhase = "offline";
    updateConnectionStatus(false, "Disconnected");

    const shouldRestoreGuestTable = snapshot.currentView === "table" && (snapshot.guestRemoteState || snapshot.roomId);
    if (shouldRestoreGuestTable) {
        showView("table");
        renderTable();
        showNotice(els.tableNotice, "Session restored. Attempting to reconnect to host...", "info");
        triggerGuestAutoRejoin("restored-session");
    } else {
        showView("guestConnect");
        renderConnectionStrategySections();
        showNotice(els.guestConnectNotice, "Session restored. Rejoin with room code or manual fallback.", "info");
        if (els.guestRoomCodeInput && state.roomId) {
            els.guestRoomCodeInput.value = state.roomId;
        }
        if (state.connectionStrategy === "manualWebRtc") {
            void onRegenerateGuestOffer();
        }
    }
    saveSessionSnapshot();
}

function openGuestManualFallbackReconnect() {
    stopGuestAutoRejoin();
    showView("guestConnect");
    setGuestStep(1);
    renderConnectionStrategySections();
    if (els.guestManualFallbackDetails) {
        els.guestManualFallbackDetails.open = true;
    }
    showNotice(
        els.guestConnectNotice,
        "Manual fallback ready. Share a fresh join code with host to reconnect.",
        "info"
    );
    void onRegenerateGuestOffer();
    saveSessionSnapshot();
}

function isGuestConnected() {
    return canGuestSendToHost();
}

export function sanitizeName(name) {
    return sanitizeDisplayName(name);
}

export function storeDisplayName(name) {
    persistDisplayName(name);
}

export function loadStoredDisplayName() {
    return loadPersistedDisplayName();
}
