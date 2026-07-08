const THEME_STORAGE_KEY = "planning-poker-theme";
const LIGHT_THEME = "light";
const DARK_THEME = "dark";

export function loadTheme(storage = window.localStorage, media = window.matchMedia) {
    const savedTheme = readSavedTheme(storage);
    if (savedTheme) return savedTheme;

    if (typeof media === "function" && media("(prefers-color-scheme: dark)").matches) {
        return DARK_THEME;
    }
    return LIGHT_THEME;
}

export function applyTheme(theme, doc = document) {
    const normalizedTheme = normalizeTheme(theme);
    doc.documentElement.dataset.theme = normalizedTheme;
    doc.documentElement.style.colorScheme = normalizedTheme;
    return normalizedTheme;
}

export function saveTheme(theme, storage = window.localStorage) {
    const normalizedTheme = normalizeTheme(theme);
    try {
        storage.setItem(THEME_STORAGE_KEY, normalizedTheme);
    } catch {
        // Theme persistence is a convenience; the applied theme should still change.
    }
    return normalizedTheme;
}

export function syncThemeToggle(toggle, label, theme) {
    if (!toggle) return;
    const isDark = normalizeTheme(theme) === DARK_THEME;
    toggle.checked = isDark;
    toggle.setAttribute("aria-checked", String(isDark));
    if (label) {
        label.textContent = isDark ? "Dark" : "Light";
    }
}

export function toggleTheme(currentTheme) {
    return normalizeTheme(currentTheme) === DARK_THEME ? LIGHT_THEME : DARK_THEME;
}

function readSavedTheme(storage) {
    try {
        const theme = storage.getItem(THEME_STORAGE_KEY);
        if (theme !== LIGHT_THEME && theme !== DARK_THEME) return null;
        return theme;
    } catch {
        return null;
    }
}

function normalizeTheme(theme) {
    return theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
}
