import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const specsDir = path.join(repoRoot, "tests/e2e/specs");
const require = createRequire(import.meta.url);
const { withSessionPages } = require("../../tests/e2e/helpers/session.js");

async function listSpecFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listSpecFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".js")) {
            files.push(fullPath);
        }
    }
    return files;
}

test("E2E specs create browser contexts only through the session harness", async () => {
    const offenders = [];
    for (const file of await listSpecFiles(specsDir)) {
        const source = await readFile(file, "utf8");
        if (source.includes("browser.newContext(")) {
            offenders.push(path.relative(repoRoot, file));
        }
    }

    assert.deepEqual(offenders, []);
});

test("withSessionPages closes its context when the callback throws", async () => {
    let closeCount = 0;
    let shutdownCount = 0;
    const browser = {
        async newContext() {
            return {
                async addInitScript() {},
                async newPage() {
                    return {
                        isClosed: () => false,
                        async evaluate() {
                            shutdownCount += 1;
                        }
                    };
                },
                async close() {
                    closeCount += 1;
                }
            };
        }
    };

    await assert.rejects(
        withSessionPages(browser, ["host", "guest"], async () => {
            throw new Error("boom");
        }),
        /boom/
    );

    assert.equal(shutdownCount, 2);
    assert.equal(closeCount, 1);
});
