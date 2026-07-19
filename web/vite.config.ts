import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    root: webRoot,
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            "/api": "http://localhost:3001",
        },
    },
    build: {
        outDir: path.join(webRoot, "dist"),
        emptyOutDir: true,
    },
});
