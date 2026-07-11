/// <reference types="vite/client" />

// Compile-time flags injected by vite.config.ts `define`. In production
// bundles these are replaced with the literal `false`, letting Rollup
// tree-shake every guarded branch (and their imports) to zero bytes.
declare const __KOINKAT_ALLOW_MOCKS__: boolean;
declare const __KOINKAT_ALLOW_DEBUG_ROUTES__: boolean;
declare const __KOINKAT_ALLOW_SANDBOX_UI__: boolean;
// true only in demo builds - activates the fixture-backed mock client.
declare const __KOINKAT_EB_MOCK_DEFAULT__: boolean;
// App version, sourced from package.json at build time.
declare const __APP_VERSION__: string;
