import { describe, expect, it, beforeEach, vi } from "vitest";
import {
    DEFAULT_STUN_SERVERS,
    formatIceServersForInput,
    getIceServers,
    parseIceServerInput,
    saveUserIceServers
} from "../../src/js/ice-config.js";

describe("ice-config", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", {
            store: new Map(),
            getItem(key) {
                return this.store.get(key) ?? null;
            },
            setItem(key, value) {
                this.store.set(key, value);
            }
        });
    });

    it("parses pipe-delimited turn lines", () => {
        const servers = parseIceServerInput(
            "turn:example.com:3478?transport=tcp | alice | secret"
        );
        expect(servers).toEqual([
            {
                urls: "turn:example.com:3478?transport=tcp",
                username: "alice",
                credential: "secret"
            }
        ]);
    });

    it("formats servers for textarea input", () => {
        const text = formatIceServersForInput([
            { urls: "stun:stun.example.com:3478" },
            { urls: "turn:turn.example.com", username: "u", credential: "p" }
        ]);
        expect(text).toContain("stun:stun.example.com:3478");
        expect(text).toContain("turn:turn.example.com | u | p");
    });

    it("merges defaults with saved custom servers", () => {
        saveUserIceServers([{ urls: "turn:custom.example.com" }]);
        const merged = getIceServers();
        expect(merged[0]).toEqual(DEFAULT_STUN_SERVERS[0]);
        expect(merged.at(-1)).toEqual({ urls: "turn:custom.example.com" });
    });
});
