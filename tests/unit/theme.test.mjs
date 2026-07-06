import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
const {
    applyTheme,
    getCurrentTheme,
    loadThemePreference,
    saveThemePreference,
    setupThemeToggle
} = await import(new URL("../../js/theme.js", import.meta.url));

function makeStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        }
    };
}

function makeButton() {
    const attrs = new Map();
    return {
        textContent: "",
        listeners: new Map(),
        setAttribute(name, value) {
            attrs.set(name, String(value));
        },
        getAttribute(name) {
            return attrs.get(name);
        },
        addEventListener(type, handler) {
            this.listeners.set(type, handler);
        },
        click() {
            this.listeners.get("click")();
        }
    };
}

describe("theme preference", () => {
    beforeEach(() => {
        globalThis.document = { documentElement: { dataset: {} } };
        globalThis.localStorage = makeStorage();
    });

    afterEach(() => {
        delete globalThis.document;
        delete globalThis.localStorage;
    });

    it("applies only supported themes and falls back to light", () => {
        assert.equal(applyTheme("dark"), "dark");
        assert.equal(getCurrentTheme(), "dark");

        assert.equal(applyTheme("unknown"), "light");
        assert.equal(getCurrentTheme(), "light");
    });

    it("loads and saves the stored theme preference", () => {
        assert.equal(loadThemePreference(), "light");
        assert.equal(saveThemePreference("dark"), "dark");
        assert.equal(loadThemePreference(), "dark");
    });

    it("syncs the toggle label, aria state, document theme, and stored preference", () => {
        const button = makeButton();

        setupThemeToggle(button);
        assert.equal(document.documentElement.dataset.theme, "light");
        assert.equal(button.textContent, "Dark Theme");
        assert.equal(button.getAttribute("aria-pressed"), "false");
        assert.equal(button.getAttribute("aria-label"), "Switch to dark theme");

        button.click();
        assert.equal(document.documentElement.dataset.theme, "dark");
        assert.equal(button.textContent, "Light Theme");
        assert.equal(button.getAttribute("aria-pressed"), "true");
        assert.equal(button.getAttribute("aria-label"), "Switch to light theme");
        assert.equal(localStorage.getItem("planning-poker-theme"), "dark");
    });
});
