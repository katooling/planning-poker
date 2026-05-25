import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [tailwindcss()],
    root: "src",
    base: "/planning-poker/",
    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },
    preview: {
        host: "127.0.0.1",
        port: 4173,
        strictPort: true,
    },
    server: {
        host: "127.0.0.1",
    },
});
