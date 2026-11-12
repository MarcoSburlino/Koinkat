# Koinkat MCP v1 plan

Implement reads and calculations first, then connect limited editing through Koinkat's own application layer.

## Progress (2026-11-09)

- Complete: Node/TypeScript setup, pinned official MCP SDK, stdio server and ten read/calculation tools.
- Complete: explicit read-only SQLite access, immutable workspace binding, strict input schemas, decimal math, bounded results and disclosed conversion failures.
- Complete: synthetic fixtures from Koinkat's actual schema (v16 since 2026-11-12), domain/reporting tests and real MCP client/server stdio tests. Commands: `npm run typecheck` and `npm test`.
- Complete: synthetic demo generator and host configuration example in `README.md`.
- Decision: `../decisions/001-read-foundation.md` selects standalone reads and a future app-mediated editing bridge.
- Complete: Codex and Claude Code registration/connectivity verified; the user confirmed the read/calculation tools work in actual use. Personal data and connection details are not recorded in this repository.
- Pending: bridge design/implementation, write tools and edit audit/confirmation policy.

## Next implementation milestone

1. Define a narrow app bridge with workspace authorization, capabilities and explicit field allowlists; decide its local transport and lifecycle.
2. Implement and test the Koinkat-side handler and app refresh, following Koinkat's own agent rules.
3. Add transaction metadata editing first, with tests showing protected fields and balances cannot change.
4. Add budgets/events, then transfer classification, recurring labels and split relationship edits; each needs service-level invariant tests and no deletion paths.
5. Add edit history/undo or previews according to the chosen user workflow. No write tool is registered before its app-side enforcement exists.

## 1. Settle the interface

Review `../spec.md` against actual user questions. Finalize the first tool set, allowed fields, filtering, pagination and structured result contracts. Clarify cloud-model policy, workspace authorization and edit confirmation behavior.

## 2. Choose the integration architecture

Audit the Koinkat repository's `src/services/`, `src/domain/`, `src/db/` and Tauri transaction bridge.

Compare an app-mediated bridge with standalone database access. Decide whether Koinkat must run, how clients connect, how access is authorized and how writes refresh the app. Do not assume existing TypeScript services run standalone: they depend on Tauri and active-workspace state.

Prefer reuse of tested business behavior. Avoid an independent writer that bypasses Koinkat balance, split, recurring, workspace or transaction guarantees. Determine if a shared library or narrowly scoped Koinkat bridge is necessary. Any changes to Koinkat require its repository rules and checks.

Select runtime, MCP SDK, transport and packaging after establishing client requirements. Record accepted technical choices in numbered `docs/decisions/` files.

## 3. Implement reads and calculations

Use synthetic data first. Implement context, filtered search, detail and complete-dataset aggregations before adding specialized views. Add deterministic decimal calculations with currency-aware inputs and explicit rounding rules.

Verify split net reporting, repayments, transfers, pending rows, unavailable rates, pagination and workspace isolation against Koinkat behavior.

## 4. Implement limited editing

Use separate narrow tools and explicit field allowlists. Ensure metadata and relationship changes cannot alter financial amounts or balances, even indirectly. Audit repayment unlinking carefully: existing delete helpers may delete real financial rows and must not be reused as classification operations.

Verify rejected protected fields, cross-workspace relationships, concurrent edits and all allowed changes. Budget limits are the explicit exception to amount immutability.

## 5. Validate the client workflow

Document installation, enable/disable, workspace selection, supported clients and error recovery. Verify calculations and approved organization workflows end to end with synthetic data. Never use personal financial databases as development fixtures.

## Completion criteria

- Agreed tools are discoverable and return bounded, documented structured results.
- Financial results match Koinkat's semantics.
- Protected fields, records and credentials cannot be reached through tools.
- Allowed organization changes preserve original financial amounts and balances.
- Budget and event limits can be created/edited within the authorized workspace.
- Runtime commands and verification instructions exist and pass for the selected stack.
