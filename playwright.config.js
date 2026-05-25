// @ts-check
import { defineConfig, devices } from "@playwright/test";

const allProjects = [
    {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
    },
    {
        name: "firefox",
        use: { ...devices["Desktop Firefox"] },
    },
    {
        name: "webkit",
        use: { ...devices["Desktop Safari"] },
    },
];

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 45_000,
    expect: {
        timeout: 15_000,
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }]]
        : [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://127.0.0.1:4173/planning-poker/",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    projects: process.env.CI ? [allProjects[0]] : allProjects,
    webServer: {
        command: "npm run build && npm run preview -- --port 4173 --strictPort",
        url: "http://127.0.0.1:4173/planning-poker/",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
