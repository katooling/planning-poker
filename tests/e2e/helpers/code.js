import { expect } from "@playwright/test";

export async function readCode(locator) {
    await expect(locator).not.toContainText("Generating code...");
    await expect(locator).not.toContainText("No response code yet.");
    const text = await locator.textContent();
    return (text || "").trim();
}

export async function decodeSignalCodeInPage(page, code) {
    return page.evaluate(async ({ codeValue }) => {
        const { decodeSignalCode } = window.__planningPokerE2E;
        return decodeSignalCode(codeValue);
    }, { codeValue: code });
}
