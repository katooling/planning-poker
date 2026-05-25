import { describe, expect, it } from "vitest";
import { decodeSignalCode, encodeSignalCode, validateSignalPayload } from "../../src/js/signaling.js";

describe("signaling codes", () => {
    it("validates expected payload type", () => {
        expect(() => validateSignalPayload({ v: 1, f: "a", d: { t: "offer" } }, "offer")).not.toThrow();
        expect(() => validateSignalPayload({ v: 1, f: "a", d: { t: "answer" } }, "offer")).toThrow(/Expected offer/);
    });

    it("round-trips uncompressed payloads when compression is unavailable", async () => {
        const payload = { v: 1, f: "guest-1", d: { t: "offer", s: "abc" } };
        const code = await encodeSignalCode(payload);
        expect(code.startsWith("U1.") || code.startsWith("C1.")).toBe(true);
        const decoded = await decodeSignalCode(code);
        expect(decoded.f).toBe("guest-1");
        expect(decoded.d.t).toBe("offer");
    });
});
