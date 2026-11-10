import { defineConfig } from "vitest/config";

// PGlite is a whole Postgres in WebAssembly: the first start in a test file takes seconds, longer when files run in parallel.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
