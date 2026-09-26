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

// Three-build structure:
//   mode=development : mocks on by default (KOINKAT_EB_REAL=1 switches the
//                      session to the real EB client); debug routes + sandbox UI visible
//   mode=demo        : mocks on by default; debug routes hidden; sandbox UI visible
//   mode=production  : mocks impossible (build aborts if somehow enabled); debug routes removed; sandbox UI hidden
export default defineConfig(({ mode }) => {
  const mocksAllowed = mode === "development" || mode === "demo";
  const debugRoutesAllowed = mode === "development";
  const sandboxUiAllowed = mode === "development" || mode === "demo";
  // Dev + demo builds activate the fixture-backed mock client by default
  // so contributors never need a live Enable Banking session to run the
  // app. Setting KOINKAT_EB_REAL=1 makes a development session use the
  // real HTTP client instead (for testing against an Enable Banking
  // sandbox application). Demo always mocks; production never mocks,
  // regardless of the variable.
  const mocksOnByDefault =
    mode === "demo" ||
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
      if (mode !== "production") return;
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const leaked = (chunk.moduleIds ?? []).filter(
          (id) => id.includes("/src/mocks/") || id.includes("\\src\\mocks\\"),
        );
        if (leaked.length > 0) {
          throw new Error(
            `Production bundle leaked mock code in chunk "${name}":\n  ` +
              leaked.join("\n  "),
          );
        }
      }
    },
  };
}
