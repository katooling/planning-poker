import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("README documents the fast unit proof command", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");

    assert.match(readme, /npm run test:unit/);
});
