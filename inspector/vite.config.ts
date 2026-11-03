import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev` (the API, :3001) and `pnpm dev:ui` (this) run side by side while developing.
export default defineConfig({
	plugins: [react()],
	server: { proxy: { "/api": "http://localhost:3001" } },
	build: { outDir: "dist" },
});
