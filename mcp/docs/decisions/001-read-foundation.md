# 001 - Local stdio server with read-only SQLite access

Date: 2026-11-09. Implementation decision for the first milestone.

## Context

Koinkat's TypeScript services depend on Tauri IPC and global active-workspace state. Importing them into a standalone Node process does not provide a functioning service layer. Its transaction updates can reverse and reapply balances, while repayment deletion can delete financial rows. Reusing these broad mutation paths would violate the MCP permission boundary.

## Decision

Use TypeScript on Node 22.13+ with the official MCP TypeScript SDK v1, local stdio transport and Node's built-in SQLite driver. SDK v1 is the currently published `@modelcontextprotocol/sdk` package checked on npm for this implementation; dependencies are pinned in the lockfile.

The first milestone opens only an explicitly supplied database path in native read-only mode with `query_only`, binds one workspace at process startup, and implements reads and deterministic decimal calculations. There is no database auto-discovery, SQL tool, credential reader, network fetch, migration runner or write tool. A database snapshot is recommended for initial use. Synthetic fixtures exercise Koinkat's actual schema through migration v15 (v16 since 2026-11-12: Koinkat's assistant tables, never read).

Use explicit SELECT column lists. Never select from `api_configs`, credential stores, or bank-session fields. Per-call read transactions keep multi-query results consistent. Return missing-rate and freshness information.

Editing will use an app-mediated integration rather than a second standalone writer. The bridge protocol, authorization and Koinkat UI refresh implementation are the next architecture milestone; no write tools are advertised until that bridge is implemented and tested. This decision does not remove the agreed editing scope.

## Consequences

The server works without a running app for reads. Node's SQLite API is experimental in Node 22, so Node may print a warning on stderr. Stdout is reserved for MCP messages.

Local stdio does not guarantee local model inference. Model-independent access includes local and cloud models through compatible clients, superseding the older local-only proposal. Codex and Claude Code registrations have been verified; each client still requires its own registration. Personal workspace selection remains in local configuration.

No app changes are required for this milestone. Calculation logic is small and independently tested against Koinkat semantics; future shared-domain extraction can reduce duplication.

References: https://ts.sdk.modelcontextprotocol.io/server and [Koinkat services](https://github.com/MarcoSburlino/Koinkat/tree/main/src/services).
