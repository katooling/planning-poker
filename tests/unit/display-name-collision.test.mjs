import { describe, it } from "node:test";
import assert from "node:assert/strict";
const {
    DISPLAY_NAME_TAKEN_CODE,
    evaluateDisplayNameChange,
    isDisplayNameTaken
} = await import(new URL("../../js/display-name-collision.js", import.meta.url));

const trim = (value) => String(value || "").trim();

function makeSession(players = {}, pending = []) {
    return {
        session: {
            players
        },
        hostPendingRejoinRequests: pending
    };
}

describe("isDisplayNameTaken", () => {
    it("returns false when session is missing", () => {
        assert.equal(isDisplayNameTaken({}, "g1", "Alex", trim), false);
    });

    it("returns false for empty sanitized name", () => {
        const state = makeSession({
            host: { id: "host", name: "Host", connected: true }
        });
        assert.equal(isDisplayNameTaken(state, "g1", "   ", trim), false);
    });

    it("detects connected guest with same name (case-sensitive)", () => {
        const state = makeSession({
            host: { id: "host", name: "Host", connected: true },
            g1: { id: "g1", name: "Alex", connected: true }
        });
        assert.equal(isDisplayNameTaken(state, "g2", "Alex", trim), true);
        assert.equal(isDisplayNameTaken(state, "g2", "alex", trim), false);
    });

    it("ignores disconnected players", () => {
        const state = makeSession({
            g1: { id: "g1", name: "Alex", connected: false }
        });
        assert.equal(isDisplayNameTaken(state, "g2", "Alex", trim), false);
    });

    it("detects pending approval with same name", () => {
        const state = makeSession(
            { host: { id: "host", name: "Host", connected: true } },
            [{ id: "g1", name: "Alex" }]
        );
        assert.equal(isDisplayNameTaken(state, "g2", "Alex", trim), true);
    });

    it("exempts the joining guest id (self)", () => {
        const state = makeSession(
            { host: { id: "host", name: "Host", connected: true } },
            [{ id: "g1", name: "Alex" }]
        );
        assert.equal(isDisplayNameTaken(state, "g1", "Alex", trim), false);
    });
});

describe("evaluateDisplayNameChange", () => {
    it("rejects empty names", () => {
        const state = makeSession({
            host: { id: "host", name: "Host", connected: true }
        });
        const result = evaluateDisplayNameChange(
            state,
            "host",
            "  ",
            trim,
            () => "Host"
        );
        assert.equal(result.ok, false);
        assert.equal(result.reason, "empty");
    });

    it("allows unchanged name without collision check", () => {
        const state = makeSession({
            host: { id: "host", name: "Host", connected: true }
        });
        const result = evaluateDisplayNameChange(
            state,
            "host",
            "Host",
            trim,
            () => "Host"
        );
        assert.equal(result.ok, true);
        assert.equal(result.unchanged, true);
    });

    it("rejects rename to taken name with code", () => {
        const state = makeSession({
            host: { id: "host", name: "Host", connected: true },
            g1: { id: "g1", name: "Alex", connected: true }
        });
        const result = evaluateDisplayNameChange(
            state,
            "g2",
            "Alex",
            trim,
            () => "Bob"
        );
        assert.equal(result.ok, false);
        assert.equal(result.code, DISPLAY_NAME_TAKEN_CODE);
    });
});
