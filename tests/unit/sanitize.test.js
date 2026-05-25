import { describe, expect, it } from "vitest";
import { sanitizeText } from "../../src/js/sanitize.js";

describe("sanitizeText", () => {
    it("trims and collapses whitespace", () => {
        expect(sanitizeText("  hello   world  ", 40)).toBe("hello world");
    });

    it("enforces max length", () => {
        expect(sanitizeText("abcdefghij", 5)).toBe("abcde");
    });

    it("uses fallback for empty input", () => {
        expect(sanitizeText("", 10, "guest")).toBe("guest");
    });
});
