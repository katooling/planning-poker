export const THEME_STORAGE_KEY = "planningPokerTheme";
export const DARK_THEME = "dark";
export const LIGHT_THEME = "light";

export function loadPreferredTheme(storage = window.localStorage) {
    try {
        const storedTheme = storage.getItem(THEME_STORAGE_KEY);
        if (storedTheme === DARK_THEME || storedTheme === LIGHT_THEME) {
            return storedTheme;
        }
    } catch (_error) {
        // Keep the app usable when storage is blocked.
    }
    return LIGHT_THEME;
}

export function savePreferredTheme(theme, storage = window.localStorage) {
    try {
        storage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
    } catch (_error) {
        // The visual toggle still works for the current page when storage fails.
    }
}

export function applyTheme(theme, options = {}) {
    const root = options.root || document.documentElement;
    const toggleButton = options.toggleButton || null;
    const normalizedTheme = normalizeTheme(theme);
    root.dataset.theme = normalizedTheme;
    root.style.colorScheme = normalizedTheme;
    updateThemeToggleButton(toggleButton, normalizedTheme);
    return normalizedTheme;
}

export function toggleTheme(options = {}) {
    const root = options.root || document.documentElement;
    const storage = options.storage || window.localStorage;
    const currentTheme = normalizeTheme(root.dataset.theme);
    const nextTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    applyTheme(nextTheme, options);
    savePreferredTheme(nextTheme, storage);
    return nextTheme;
}

function normalizeTheme(theme) {
    return theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
}

function updateThemeToggleButton(toggleButton, theme) {
    if (!toggleButton) return;
    const isDark = theme === DARK_THEME;
    toggleButton.textContent = isDark ? "Light Theme" : "Dark Theme";
    toggleButton.setAttribute("aria-pressed", String(isDark));
}
