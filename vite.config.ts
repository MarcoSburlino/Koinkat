/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { createRequire } from "node:module";
import pkg from "./package.json";

// The integration harness (src/test/sqlite-harness.ts) runs the real
// migrations against node:sqlite. That module is unflagged from Node 22.13,
// but needs --experimental-sqlite on older 22.x. Probe the running Node
// rather than hardcoding a flag: passing a flag a future Node has retired
// would break the whole suite, and omitting one an older Node needs would
// break it too.
const sqliteExecArgv: string[] = (() => {
  try {
    createRequire(import.meta.url)("node:sqlite");
    return [];
  } catch {
    return ["--experimental-sqlite"];
  }
})();

// Development keeps offline fixtures. Demo uses real HTTP but accepts only
// provider-verified sandbox credentials. Neither distributable ships mocks.
export default defineConfig(({ mode }) => {
  const mocksAllowed = mode === "development";
  const debugRoutesAllowed = mode === "development";
  const sandboxUiAllowed = mode === "development" || mode === "demo";
  // The variable affects development only; installed Demo always uses HTTP.
  const mocksOnByDefault =
    (mode === "development" && process.env.KOINKAT_EB_REAL !== "1");

  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [
      react(),
      tailwindcss(),
      forbidMocksInProductionBundle(mode),
    ],
    define: {
      // Compile-time flags - replaced as string literals in the bundle.
      // When `false`, all guarded branches (and their static imports) become
      // dead code and are removed by Rollup's tree-shaking.
      __KOINKAT_ALLOW_MOCKS__: JSON.stringify(mocksAllowed),
      __KOINKAT_ALLOW_DEBUG_ROUTES__: JSON.stringify(debugRoutesAllowed),
      __KOINKAT_ALLOW_SANDBOX_UI__: JSON.stringify(sandboxUiAllowed),
      __KOINKAT_DEMO_APP__: JSON.stringify(mode === "demo"),
      __KOINKAT_EB_MOCK_DEFAULT__: JSON.stringify(mocksOnByDefault),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    build: {
      outDir: mode === "demo" ? "dist-demo" : "dist",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("recharts") || id.includes("date-fns")) {
              return "vendor-charts";
            }
          },
        },
      },
    },
    // Vitest shares this config so the __KOINKAT_* define flags above apply
    // to tests too - the Enable Banking dispatcher reads them at module load,
    // so a standalone vitest.config.ts would break every bank-sync suite.
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      execArgv: sqliteExecArgv,
    },
  };
});

// Defense-in-depth: fail the build if any chunk in a production bundle
// references a module under src/mocks/. Catches regressions where a new
// import slips past the compile-time flags.
function forbidMocksInProductionBundle(mode: string): Plugin {
  return {
    name: "koinkat-forbid-mocks-in-production",
    enforce: "post",
    generateBundle(_opts, bundle) {
      if (mode !== "production" && mode !== "demo") return;
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const leaked = (chunk.moduleIds ?? []).filter(
          (id) => id.includes("/src/mocks/") || id.includes("\\src\\mocks\\"),
        );
        if (leaked.length > 0) {
          throw new Error(
            `${mode} bundle leaked mock code in chunk "${name}":\n  ` +
              leaked.join("\n  "),
          );
        }
      }
    },
  };
}
