import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DARK_THEME,
    LIGHT_THEME,
    THEME_STORAGE_KEY,
    applyTheme,
    loadPreferredTheme,
    toggleTheme
} from "../../js/theme.js";

describe("theme preferences", () => {
    it("defaults to light when no stored theme exists", () => {
        const storage = createStorage();

        assert.equal(loadPreferredTheme(storage), LIGHT_THEME);
    });

    it("applies dark theme state to the root and toggle button", () => {
        const root = createRoot();
        const toggleButton = createButton();

        applyTheme(DARK_THEME, { root, toggleButton });

        assert.equal(root.dataset.theme, DARK_THEME);
        assert.equal(root.style.colorScheme, DARK_THEME);
        assert.equal(toggleButton.textContent, "Light Theme");
        assert.equal(toggleButton.getAttribute("aria-pressed"), "true");
    });

    it("toggles theme and persists the selected value", () => {
        const root = createRoot();
        const storage = createStorage();
        const toggleButton = createButton();
        root.dataset.theme = LIGHT_THEME;

        const nextTheme = toggleTheme({ root, storage, toggleButton });

        assert.equal(nextTheme, DARK_THEME);
        assert.equal(root.dataset.theme, DARK_THEME);
        assert.equal(storage.getItem(THEME_STORAGE_KEY), DARK_THEME);
        assert.equal(toggleButton.textContent, "Light Theme");
    });
});

function createRoot() {
    return {
        dataset: {},
        style: {}
    };
}

function createButton() {
    const attributes = new Map();
    return {
        textContent: "",
        setAttribute(name, value) {
            attributes.set(name, value);
        },
        getAttribute(name) {
            return attributes.get(name);
        }
    };
}

function createStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, value);
        }
    };
}
