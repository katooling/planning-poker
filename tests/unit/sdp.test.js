import { describe, expect, it } from "vitest";
import { compactFromDescription, descriptionFromCompact } from "../../src/js/sdp.js";

describe("sdp compact round-trip", () => {
    it("round-trips modern compact payloads", () => {
        const original = {
            type: "offer",
            sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
        };
        const compact = compactFromDescription(original);
        const restored = descriptionFromCompact(compact);
        expect(restored.type).toBe("offer");
        expect(restored.sdp).toBe(original.sdp);
    });

    it("rebuilds legacy compact payloads", () => {
        const legacy = {
            t: "offer",
            u: "abc",
            p: "def",
            f: "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899",
        };
        const restored = descriptionFromCompact(legacy);
        expect(restored.type).toBe("offer");
        expect(restored.sdp).toContain("a=ice-ufrag:abc");
        expect(restored.sdp).toContain("a=fingerprint:sha-256");
    });
});
