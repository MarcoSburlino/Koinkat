/**
 * Argument lists for each engine, built only through `fillArgs` so every
 * value is checked against the same validators Tauri enforces (see
 * programs.ts). Pure functions: no IPC, unit-tested.
 */
import { fillArgs } from './programs';

/** Everything an engine needs to reach the read-only Koinkat MCP server. */
export interface McpLaunch {
  /** Absolute path of a Node >= 22.13 executable. */
  nodePath: string;
  /** Absolute path of the bundled server (`koinkat-mcp.mjs`). */
  bundlePath: string;
  /** Absolute path of this installation's `koinkat.db`. */
  dbPath: string;
  /** The workspace the chat belongs to (captured at turn start). */
  workspaceId: string;
}

export const DEFAULT_CLAUDE_MODEL = 'sonnet';

export function claudeMcpConfigJson(l: McpLaunch): string {
  return JSON.stringify({
    mcpServers: {
      koinkat: {
        command: l.nodePath,
        args: [l.bundlePath, '--database', l.dbPath, '--workspace', l.workspaceId],
      },
    },
  });
}

export function claudeRunArgs(l: McpLaunch, model: string | null, systemPrompt: string): string[] {
  return fillArgs('claude', 'run', [
    claudeMcpConfigJson(l),
    model ?? DEFAULT_CLAUDE_MODEL,
    systemPrompt,
  ]);
}

/** One `--input-format stream-json` line carrying the whole turn. */
export function claudeStdinMessage(prompt: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n';
}

/** TOML literal string: no escapes, so Windows backslashes survive. */
function tomlLiteral(s: string): string {
  if (s.includes("'")) throw new Error('Paths with a single quote are not supported');
  return `'${s}'`;
}

/**
 * Argv for `node codex-run.mjs <codex> -- exec ...` (see programs.ts for
 * why Codex goes through the launcher).
 */
export function codexRunArgs(
  l: McpLaunch,
  launcherPath: string,
  codexPath: string,
  workdir: string,
  prompt: string,
): string[] {
  return fillArgs('node', 'codex-run', [
    launcherPath,
    codexPath,
    workdir,
    `mcp_servers.koinkat.command=${tomlLiteral(l.nodePath)}`,
    `mcp_servers.koinkat.args=[${[l.bundlePath, '--database', l.dbPath, '--workspace', l.workspaceId]
      .map(tomlLiteral)
      .join(', ')}]`,
    prompt,
  ]);
}

export function nodeMcpArgs(l: McpLaunch): string[] {
  return fillArgs('node', 'mcp', [l.bundlePath, l.dbPath, l.workspaceId]);
}

/** `claude mcp add` / `codex mcp add`: register Koinkat in the user's CLI. */
export function registerArgs(kind: 'claude' | 'codex', l: McpLaunch): string[] {
  return fillArgs(kind, 'mcp-add', [l.nodePath, l.bundlePath, l.dbPath, l.workspaceId]);
}

/** The same registration as a copyable command, for other MCP clients. */
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
