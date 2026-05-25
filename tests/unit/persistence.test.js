import { describe, expect, it } from "vitest";
import {
    normalizeId,
    normalizeLoadedSnapshot,
    normalizeRoleView,
    normalizeVote
} from "../../src/js/persistence.js";

describe("persistence normalization", () => {
    it("normalizes role views", () => {
        expect(normalizeRoleView("host", "table")).toBe("table");
        expect(normalizeRoleView("host", "home")).toBe("hostLobby");
        expect(normalizeRoleView("guest", "guestConnect")).toBe("guestConnect");
    });

    it("accepts only known vote tokens", () => {
        expect(normalizeVote("8")).toBe("8");
        expect(normalizeVote("coffee")).toBe("coffee");
        expect(normalizeVote("not-a-card")).toBeNull();
    });

    it("rejects invalid ids", () => {
        expect(normalizeId("")).toBe("");
        expect(normalizeId("a".repeat(80))).toBe("");
        expect(normalizeId("guest-1")).toBe("guest-1");
    });

    it("drops expired snapshots", () => {
        const snapshot = normalizeLoadedSnapshot({
            v: 1,
            savedAt: Date.now() - 13 * 60 * 60 * 1000,
            role: "guest",
            localId: "guest-1",
            displayName: "Guest",
            currentView: "table"
        });
        expect(snapshot).toBeNull();
    });

    it("normalizes guest table snapshots", () => {
        const snapshot = normalizeLoadedSnapshot({
            v: 1,
            savedAt: Date.now(),
            role: "guest",
            localId: "guest-1",
            displayName: "  Guest  ",
            currentView: "table",
            guestRemoteState: {
                round: 2,
                roundTitle: "  Sprint  ",
                started: true,
                revealed: false,
                players: [{ id: "host-1", name: "Host", isHost: true, connected: true, vote: null }]
            }
        });
        expect(snapshot.displayName).toBe("Guest");
        expect(snapshot.guestRemoteState.round).toBe(2);
        expect(snapshot.guestRemoteState.roundTitle).toBe("Sprint");
    });
});
