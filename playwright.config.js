// @ts-check
const { execFileSync } = require("node:child_process");
const { defineConfig, devices } = require("@playwright/test");

const DEFAULT_E2E_PORT = 4173;

function pickE2EPort() {
    if (process.env.PLAYWRIGHT_TEST_PORT) {
        const configuredPort = Number(process.env.PLAYWRIGHT_TEST_PORT);
        if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
            throw new Error("PLAYWRIGHT_TEST_PORT must be a TCP port number between 1 and 65535.");
        }

        return configuredPort;
    }

    const script = `
const net = require("node:net");
const start = Number(process.argv[1]);
const end = start + 100;

function tryPort(port) {
    if (port > end) {
        console.error("No available local E2E port found.");
        process.exit(1);
    }

    const server = net.createServer();
    server.once("error", () => tryPort(port + 1));
    server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => console.log(address.port));
    });
}

tryPort(start);
`;

    return Number(execFileSync(process.execPath, ["-e", script, String(DEFAULT_E2E_PORT)], {
        encoding: "utf8"
    }).trim());
}

const e2ePort = pickE2EPort();
const e2eBaseURL = `http://127.0.0.1:${e2ePort}`;

const allProjects = [
    {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] }
    },
    {
        name: "firefox",
        use: { ...devices["Desktop Firefox"] }
    },
    {
        name: "webkit",
        use: { ...devices["Desktop Safari"] }
    }
];

module.exports = defineConfig({
    testDir: "./tests/e2e",
    timeout: 45_000,
    expect: {
        timeout: 15_000
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }]]
        : [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: e2eBaseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure"
    },
    projects: process.env.CI ? [allProjects[0]] : allProjects,
    webServer: {
        command: `python3 -m http.server ${e2ePort} --bind 127.0.0.1`,
        url: e2eBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
    }
});
