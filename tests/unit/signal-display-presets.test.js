import { describe, expect, it } from "vitest";
import {
    EMPTY_GUEST_JOIN_CODE_DISPLAY,
    EMPTY_HOST_RESPONSE_CODE_DISPLAY,
} from "../../src/js/signal-display-presets.js";

describe("signal-display-presets", () => {
    it("defines stable guest empty copy", () => {
        expect(EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyText).toMatch(/Generating code/i);
        expect(EMPTY_GUEST_JOIN_CODE_DISPLAY.rawCode).toBe("");
    });

    it("defines stable host empty copy", () => {
        expect(EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyText).toMatch(/No response code yet/i);
        expect(EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyQualityText).toMatch(/waiting/i);
    });
});
