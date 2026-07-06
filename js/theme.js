const STORAGE_THEME_KEY = "planning-poker-theme";
const THEME_DARK = "dark";
const THEME_LIGHT = "light";

function normalizeTheme(theme) {
    return theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

export function getCurrentTheme() {
    return normalizeTheme(document.documentElement.dataset.theme);
}

export function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    document.documentElement.dataset.theme = normalized;
    return normalized;
}

export function loadThemePreference() {
    try {
        return normalizeTheme(localStorage.getItem(STORAGE_THEME_KEY));
    } catch (_error) {
        return THEME_LIGHT;
    }
}

export function saveThemePreference(theme) {
    const normalized = normalizeTheme(theme);
    try {
        localStorage.setItem(STORAGE_THEME_KEY, normalized);
    } catch (_error) {
        // Ignore localStorage failures.
    }
    return normalized;
}

export function setupThemeToggle(button) {
    if (!button) return;

    const syncButton = (theme) => {
        const isDark = theme === THEME_DARK;
        button.textContent = isDark ? "Light Theme" : "Dark Theme";
        button.setAttribute("aria-pressed", String(isDark));
        button.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
    };

    syncButton(applyTheme(loadThemePreference()));

    button.addEventListener("click", () => {
        const nextTheme = getCurrentTheme() === THEME_DARK ? THEME_LIGHT : THEME_DARK;
        syncButton(applyTheme(saveThemePreference(nextTheme)));
    });
}
