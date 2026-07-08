const STORAGE_THEME_KEY = "planningPoker.theme";
const THEMES = new Set(["light", "dark"]);

export function loadThemePreference() {
    try {
        const saved = localStorage.getItem(STORAGE_THEME_KEY);
        if (THEMES.has(saved)) return saved;
    } catch (_error) {
        // Ignore localStorage failures.
    }
    return "light";
}

export function saveThemePreference(theme) {
    const normalized = THEMES.has(theme) ? theme : "light";
    try {
        localStorage.setItem(STORAGE_THEME_KEY, normalized);
    } catch (_error) {
        // Ignore localStorage failures.
    }
    return normalized;
}

export function applyTheme(theme) {
    const normalized = THEMES.has(theme) ? theme : "light";
    document.documentElement.dataset.theme = normalized;
    document.documentElement.style.colorScheme = normalized;
    return normalized;
}

export function getNextTheme(theme) {
    return theme === "dark" ? "light" : "dark";
}
