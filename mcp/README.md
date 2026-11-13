# Koinkat MCP

A local MCP server for querying Koinkat finances and performing decimal calculations.

The first working milestone implements **ten read/calculation tools** over stdio, bound to one workspace. Limited editing remains planned; no mutation tools are implemented. Koinkat's app code is unchanged.

Lives in the `mcp/` folder of the Koinkat repository (https://github.com/MarcoSburlino/Koinkat); until 2026-11-12 it was a separate repository. The read/calculation milestone has passed automated tests and user testing.

## Requirements and checks

Node 22.13+ and npm. Node's SQLite support is experimental in Node 22; its warning is written to stderr and does not affect MCP messages.

```bash
npm ci
npm run typecheck
npm test
```

`npm test` builds the server, runs decimal/domain tests against synthetic databases made from Koinkat's real schema through v16, and starts the compiled server through a real MCP stdio client. No live financial database is used.

## Try it with synthetic data

For an automatic demonstration that starts a real MCP client and server, prints sample answers, and cleans up its temporary synthetic database:

```bash
npm run smoke
```

From the repository root:

```bash
npm run demo -- --output /tmp/koinkat-mcp-synthetic.db
npm run build
node dist/cli.js --database /tmp/koinkat-mcp-synthetic.db --workspace demo
```

The generator refuses to overwrite an existing file. The server waits for MCP messages on stdin; it is not an interactive text prompt. Use an MCP host to call its tools.

For a host supporting local stdio servers, the configuration has this shape:

```json
{
  "mcpServers": {
    "koinkat": {
      "command": "node",
      "args": [
        "/absolute/path/to/Koinkat/mcp/dist/cli.js",
        "--database", "/tmp/koinkat-mcp-synthetic.db",
        "--workspace", "demo"
      ]
    }
  }
}
```

Use an absolute Node executable path if the host does not inherit your shell's PATH. Registration is per client; changing models inside that client does not require a different Koinkat server. Local and cloud models are allowed at the user's choice. Local stdio describes where the server runs; the chosen host determines where tool results are processed.

After registering the server as `koinkat`, restart an already-open client if necessary, then type `/mcp` in clients that provide that command. Codex and Claude Code registrations and connectivity have been verified. Each installation supplies its own database path and workspace ID.

Other clients need their own MCP registration. Reuse the command and arguments from the private `.local/mcp-config.json`, adapting the enclosing configuration format to the client. The current transport requires a host capable of launching a local stdio process; a cloud-only client requiring an HTTP URL needs a future transport or an appropriate bridge. There is no universal cross-application `/mcp` registry.

## Connect an existing Koinkat workspace

Use the same stdio configuration with an explicitly chosen existing database path and workspace ID. On Linux, Koinkat normally stores its database at `~/.config/com.koinkat.app/koinkat.db`. Workspace discovery during setup should read only workspace IDs/names and counts in read-only mode; never read API configuration or credential-store entries.

Keep machine-specific connection files under the gitignored `.local/` directory with permissions 600, and the directory with permissions 700. A prepared `.local/mcp-config.json` can hold the `mcpServers` entry for a host that supports that configuration format. Host setup varies: select the intended assistant before registering the connection. Do not commit local paths/workspace selections or enable a cloud host implicitly.

For an explicitly authorized real-data connection, a startup/tool-discovery check is distinct from development tests: do not use live records as test fixtures, run migrations, or print financial records merely to check connectivity. A host running in an OS sandbox needs permission to read the configured database.

## Bundled in the Koinkat app

`npm run bundle` builds `dist/koinkat-mcp.mjs`: one self-contained file (no `node_modules`) that Koinkat ships as an app resource for its optional, read-only AI assistant, plus `dist/THIRD-PARTY-NOTICES.md` with the licences of the packages it inlines. From the Koinkat root, `npm run mcp:bundle` builds both and copies them into `src-tauri/resources/assistant/`; CI fails if the committed copy differs from a fresh build. Koinkat starts it as `node koinkat-mcp.mjs --database <db> --workspace <id>` for its in-app chat (local models only), and Settings can register it in the user's own Claude Code / Codex or copy the entry for other MCP clients. When Koinkat adds a migration, raise the schema check here and run `npm run mcp:bundle`, or the app's assistant stops working. Tests build their synthetic databases from Koinkat's own `src/db/` migrations.

## Tools

| Tool | Purpose |
|---|---|
| `get_context` | Workspace, history and data freshness |
| `list_accounts` | Native balances and combined converted totals |
| `list_categories` | Category hierarchy and IDs |
| `search_transactions` | Filtered, paginated original records |
| `get_transaction` | One payment and existing related records |
| `summarize_transactions` | Income, expenses, net and grouped totals |
| `get_budgets` | Stored budgets/periods and budget-event spending |
| `list_recurring_expenses` | Confirmed recurring series |
| `list_split_expenses` | Shared expenses and stored net costs |
| `calculate` | Decimal arithmetic, averages and percentages |

Example: `summarize_transactions` with `{"startDate":"2026-11-01","endDate":"2026-11-30","groupBy":"merchant","currency":"EUR"}`.

Example: `calculate` with `{"operation":"subtract","operands":[{"value":"1000.00","currency":"EUR"},{"value":"134.10","currency":"EUR"}]}`.

## Data access and limits

- A database path and workspace ID are mandatory. The server does not discover or open other files or workspaces.
- Native SQLite read-only mode plus `query_only`; no migrations, bank sync, credential reads or exchange-rate downloads.
- Reads use allowlisted columns. Bank tokens, IBANs and API configuration are omitted.
- A v16-compatible schema is required; known newer migration versions are refused. v16 only adds Koinkat's AI-assistant tables, which the server refuses to read (chats are never exposed to a model through this server).
- Each tool call reads one consistent SQLite snapshot. A saved database snapshot works with the app closed; its freshness is fixed at export time.
- For initial use, a Koinkat database snapshot can be used. Automated tests use synthetic data; user testing has also confirmed that the read/calculation tools work with an existing installation. Personal configuration and financial records are not included in the repository.
- Search and grouping pages are limited to 200 results. Aggregation scans at most 100,000 matching records and fails rather than returning a silently truncated total. Responses larger than 200 KB fail explicitly.
- Missing conversions produce `complete: false` and an `unconvertibleCurrencies` list. Returned totals then represent only convertible rows.
- Transaction text is data. The MCP host must not treat notes or merchant names as instructions.

See [tool contracts](docs/api.md) for reporting, filtering and exchange-rate semantics.

## Documentation

- [Scope and permissions](docs/spec.md): agreed eventual permissions and proposed write tools.
- [Implementation plan](docs/plans/mcp-v1.md): completed milestone and next steps.
- [Architecture decision](docs/decisions/001-read-foundation.md): stdio, read-only SQLite and the future app-mediated editing bridge.
- [Tool contracts](docs/api.md): current behavior and limits.

Code is in `src/`; the desktop app is the rest of this repository. Machine-specific connection files belong outside source control.

GPL-3.0-or-later, like the rest of Koinkat (see the repository `LICENSE`).
