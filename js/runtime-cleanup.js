const cleanupsByScope = {
    guest: new Set(),
    host: new Set()
};

export function registerRuntimeCleanup(scope, cleanupFn) {
    const cleanups = cleanupsByScope[scope];
    if (!cleanups || typeof cleanupFn !== "function") {
        return () => {};
    }
    cleanups.add(cleanupFn);
    return () => {
        cleanups.delete(cleanupFn);
    };
}

export function runRuntimeCleanup(scope) {
    const cleanups = cleanupsByScope[scope];
    if (!cleanups) return;
    for (const cleanupFn of Array.from(cleanups)) {
        try {
            cleanupFn();
        } catch (_error) {
            // Cleanup must never block session shutdown.
        }
    }
}

export function getRuntimeCleanupDiagnosticsForTest() {
    return {
        guestCleanupCount: cleanupsByScope.guest.size,
        hostCleanupCount: cleanupsByScope.host.size
    };
}
