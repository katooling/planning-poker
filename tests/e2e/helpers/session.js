async function withSessionPages(browser, names, callback, options = {}) {
    const context = await browser.newContext(options.contextOptions || {});
    await context.addInitScript(() => {
        window.__PP_TEST_MODE = true;
    });
    if (options.initScript) {
        await context.addInitScript(options.initScript);
    }

    const pages = {};
    try {
        for (const name of names) {
            pages[name] = await context.newPage();
            if (options.runtimeOverrides) {
                await setRuntimeOverrides(pages[name], options.runtimeOverrides);
            }
        }
        return await callback({ context, ...pages });
    } finally {
        for (const page of Object.values(pages)) {
            await shutdownPage(page, options.shutdownOptions || { clearSnapshot: true });
        }
        await context.close();
    }
}

async function shutdownPage(page, options = {}) {
    if (!page || page.isClosed()) return;
    try {
        await page.evaluate(async (shutdownOptions) => {
            await window.__planningPokerTest?.shutdownAll?.(shutdownOptions);
        }, options);
    } catch (_error) {
        // The page may not have loaded the app yet; context close is still authoritative.
    }
}

async function setRuntimeOverrides(page, overrides = {}) {
    await page.evaluate((entries) => {
        for (const [key, value] of entries) {
            if (value === null || typeof value === "undefined") {
                delete window[key];
                continue;
            }
            window[key] = value;
        }
    }, Object.entries(overrides));
}

async function getRuntimeDiagnostics(page) {
    return page.evaluate(() => {
        return window.__planningPokerTest?.diagnostics?.() || null;
    });
}

module.exports = {
    withSessionPages,
    setRuntimeOverrides,
    getRuntimeDiagnostics
};
