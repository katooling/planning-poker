import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
    applyTheme,
    loadTheme,
    saveTheme,
    syncThemeToggle,
    toggleTheme
} = await import(new URL("../../js/theme.js", import.meta.url));

function makeStorage(initial = {}) {
    const values = { ...initial };
    return {
        getItem(key) {
            return Object.hasOwn(values, key) ? values[key] : null;
        },
        setItem(key, value) {
            values[key] = String(value);
        },
        values
    };
}

describe("theme preferences", () => {
    it("loads a saved theme before checking system preference", () => {
        const storage = makeStorage({ "planning-poker-theme": "light" });
        const media = () => ({ matches: true });

        assert.equal(loadTheme(storage, media), "light");
    });

    it("falls back to system dark preference when no saved theme exists", () => {
        const storage = makeStorage();
        const media = () => ({ matches: true });

        assert.equal(loadTheme(storage, media), "dark");
    });

    it("falls back when browser storage is blocked during property access", () => {
        const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            get() {
                return {
                    get localStorage() {
                        throw new Error("storage blocked");
                    },
                    matchMedia() {
                        return { matches: true };
                    }
                };
            }
        });

        try {
            assert.equal(loadTheme(), "dark");
            assert.equal(saveTheme("dark"), "dark");
        } finally {
            if (originalWindowDescriptor) {
                Object.defineProperty(globalThis, "window", originalWindowDescriptor);
            } else {
                delete globalThis.window;
            }
        }
    });

    it("applies only supported theme names to the document element", () => {
        const doc = {
            documentElement: {
                dataset: {},
                style: {}
            }
        };

        assert.equal(applyTheme("dark", doc), "dark");
        assert.equal(doc.documentElement.dataset.theme, "dark");
        assert.equal(doc.documentElement.style.colorScheme, "dark");

        assert.equal(applyTheme("unknown", doc), "light");
        assert.equal(doc.documentElement.dataset.theme, "light");
    });

    it("saves normalized theme names", () => {
        const storage = makeStorage();

        assert.equal(saveTheme("dark", storage), "dark");
        assert.equal(storage.values["planning-poker-theme"], "dark");

        assert.equal(saveTheme("other", storage), "light");
        assert.equal(storage.values["planning-poker-theme"], "light");
    });

    it("syncs the switch state and label text", () => {
        const attributes = {};
        const toggle = {
            checked: false,
            setAttribute(name, value) {
                attributes[name] = value;
            }
        };
        const label = { textContent: "" };

        syncThemeToggle(toggle, label, "dark");

        assert.equal(toggle.checked, true);
        assert.equal(attributes["aria-checked"], "true");
        assert.equal(label.textContent, "Dark");
    });

    it("toggles between light and dark theme names", () => {
        assert.equal(toggleTheme("light"), "dark");
        assert.equal(toggleTheme("dark"), "light");
    });
});
