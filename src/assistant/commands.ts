/**
 * Argument lists for the programs the assistant starts, built only through
 * `fillArgs` so every value is checked against the same validators Tauri
 * enforces (see programs.ts). Pure functions: no IPC, unit-tested.
 */
import { fillArgs } from './programs';

/** Everything needed to start the read-only Koinkat MCP server. */
export interface McpLaunch {
  /** Absolute path of a Node >= 22.13 executable. */
  nodePath: string;
  /** Absolute path of the bundled server (`koinkat-mcp.mjs`). */
  bundlePath: string;
  /** Absolute path of this installation's `koinkat.db`. */
  dbPath: string;
  /** The workspace the server is bound to. */
  workspaceId: string;
}

/** `node koinkat-mcp.mjs --database <db> --workspace <id>` (in-app chat). */
export function nodeMcpArgs(l: McpLaunch): string[] {
  return fillArgs('node', 'mcp', [l.bundlePath, l.dbPath, l.workspaceId]);
}

/** `claude mcp add` / `codex mcp add`: register Koinkat in the user's own CLI. */
export function registerArgs(kind: 'claude' | 'codex', l: McpLaunch): string[] {
  return fillArgs(kind, 'mcp-add', [l.nodePath, l.bundlePath, l.dbPath, l.workspaceId]);
}

/** The same registration as JSON, for other MCP clients. */
export function mcpServerJsonForOtherClients(l: McpLaunch): string {
  return JSON.stringify(
    {
      mcpServers: {
        koinkat: {
          command: l.nodePath,
          args: [l.bundlePath, '--database', l.dbPath, '--workspace', l.workspaceId],
        },
      },
    },
    null,
    2,
  );
}
