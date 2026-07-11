import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import pkg from "./package.json";

// Three-build structure:
//   mode=development : mocks available but off by default; debug routes + sandbox UI visible
//   mode=demo        : mocks on by default; debug routes hidden; sandbox UI visible
//   mode=production  : mocks impossible (build aborts if somehow enabled); debug routes removed; sandbox UI hidden
export default defineConfig(({ mode }) => {
  const mocksAllowed = mode === "development" || mode === "demo";
  const debugRoutesAllowed = mode === "development";
  const sandboxUiAllowed = mode === "development" || mode === "demo";
  // Dev + demo builds activate the fixture-backed mock client by default
  // so contributors never need a live Enable Banking session to run the
  // app. To test the real client in dev, flip this to `mode === "demo"`
  // for the session.
  const mocksOnByDefault = mode === "development" || mode === "demo";

  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [
      react(),
      tailwindcss(),
      forbidMocksInProductionBundle(mode),
    ],
    define: {
      // Compile-time flags — replaced as string literals in the bundle.
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
