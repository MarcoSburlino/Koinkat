/**
 * The Tauri capability that lets the assistant start programs is
 * GENERATED from programs.ts. This test fails when the two drift, so a
 * flag added in code but not in the capability (or the reverse) is
 * caught before Tauri rejects it at runtime.
 *
 * Regenerate after editing programs.ts:
 *   UPDATE_ASSISTANT_CAPABILITY=1 npx vitest run src/assistant/capability.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssistantCapability, ARG_PATTERNS, CODEX_EXEC_ARGS, VALIDATORS, toJsRegex } from './programs';
import {
  claudeRunArgs,
  codexRunArgs,
  nodeMcpArgs,
  registerArgs,
  claudeMcpConfigJson,
  type McpLaunch,
} from './commands';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src-tauri', 'capabilities', 'assistant.json');
const generated = JSON.stringify(buildAssistantCapability(), null, 2) + '\n';

if (process.env.UPDATE_ASSISTANT_CAPABILITY === '1') writeFileSync(FILE, generated);

const posix: McpLaunch = {
  nodePath: '/usr/bin/node',
  bundlePath: '/usr/lib/Koinkat/assistant/koinkat-mcp.mjs',
  dbPath: '/home/alex/.config/com.koinkat.app/koinkat.db',
  workspaceId: 'a5a79321-a408-451a-9540-684b70001727',
};
const windows: McpLaunch = {
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  bundlePath: 'C:\\Program Files\\Koinkat\\assistant\\koinkat-mcp.mjs',
  dbPath: 'C:\\Users\\Alex\\AppData\\Roaming\\com.koinkat.app\\koinkat.db',
  workspaceId: 'a5a79321-a408-451a-9540-684b70001727',
};

describe('assistant capability file', () => {
  it('matches what programs.ts generates', () => {
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8')).toBe(generated);
  });

  it('keeps every lockdown flag fixed (never a validator slot)', () => {
    const claude = ARG_PATTERNS.claude.run;
    for (const flag of ['--restricted', '--strict-mcp-config', '--no-session-persistence']) {
      expect(claude).toContain(flag);
    }
    expect(claude[claude.indexOf('--tools') + 1]).toBe('');
    expect(claude[claude.indexOf('--allowedTools') + 1]).toBe('mcp__koinkat');
    const codex = CODEX_EXEC_ARGS;
    expect(codex[codex.indexOf('-s') + 1]).toBe('read-only');
    for (const feature of ['shell_tool', 'browser_use', 'computer_use', 'in_app_browser', 'apps']) {
      expect(codex.some((a, i) => a === feature && codex[i - 1] === '--disable')).toBe(true);
    }
    expect(codex).toContain('approval_policy="never"');
  });

  it('compiles every validator in JS too', () => {
    for (const re of Object.values(VALIDATORS)) {
      expect(() => new RegExp(`^(?:${toJsRegex(re)})$`)).not.toThrow();
    }
  });
});

describe('command builders', () => {
  it.each([['posix', posix], ['windows', windows]] as const)('builds valid %s argv', (_n, l) => {
    expect(claudeRunArgs(l, null, 'You are Koinkat.')).toContain(claudeMcpConfigJson(l));
    const launcher = l.bundlePath.replace('koinkat-mcp.mjs', 'codex-run.mjs');
    const codexPath = l === posix ? '/home/alex/.local/bin/codex' : '/usr/local/bin/codex';
    expect(codexRunArgs(l, launcher, codexPath, l.dbPath.replace('koinkat.db', 'workdir'), 'Question: hi')).toHaveLength(ARG_PATTERNS.node['codex-run'].length);
    expect(nodeMcpArgs(l)).toEqual([l.bundlePath, '--database', l.dbPath, '--workspace', l.workspaceId]);
    expect(registerArgs('claude', l).slice(0, 6)).toEqual(['mcp', 'add', '--scope', 'user', 'koinkat', '--']);
    expect(registerArgs('codex', l).slice(-1)[0]).toBe(l.workspaceId);
  });

  it('refuses values that could act as flags or escape their slot', () => {
    expect(() => claudeRunArgs(posix, '--dangerously-skip-permissions', 'You')).toThrow(/not allowed/);
    expect(() => claudeRunArgs(posix, null, '--append')).toThrow(/not allowed/);
    expect(() => codexRunArgs(posix, posix.bundlePath.replace('koinkat-mcp', 'codex-run'), '/usr/bin/codex', '/tmp/w', '-c something')).toThrow(/not allowed/);
    expect(() => nodeMcpArgs({ ...posix, dbPath: '/etc/passwd' })).toThrow(/not allowed/);
    expect(() => nodeMcpArgs({ ...posix, workspaceId: 'x; rm -rf /' })).toThrow(/not allowed/);
    expect(() => claudeRunArgs({ ...posix, nodePath: 'node' }, null, 'You')).toThrow(/not allowed/);
  });
});

describe('path rules (compromised-webview hardening)', () => {
  const ok = (re: string, value: string) => new RegExp(`^(?:${toJsRegex(re)})$`).test(value);

  it('runs Node only from known install paths', () => {
    for (const p of ['/usr/bin/node', '/usr/bin/node-22', '/opt/homebrew/bin/node', '/home/alex/.local/bin/node', 'C:\\Program Files\\nodejs\\node.exe']) {
      expect(ok(VALIDATORS.node, p)).toBe(true);
    }
    for (const p of ['/home/alex/Downloads/node', '/tmp/node', '/home/alex/.local/bin/node/../../Downloads/x', 'node']) {
      expect(ok(VALIDATORS.node, p)).toBe(false);
    }
  });

  it('runs scripts only from app install folders', () => {
    for (const p of [
      '/usr/lib/Koinkat/assistant/koinkat-mcp.mjs',
      '/usr/lib/Koinkat Demo/assistant/koinkat-mcp.mjs',
      '/Applications/Koinkat.app/Contents/Resources/assistant/koinkat-mcp.mjs',
      'C:\\Program Files\\Koinkat\\assistant\\koinkat-mcp.mjs',
      'C:\\Users\\Alex\\AppData\\Local\\Koinkat\\assistant\\koinkat-mcp.mjs',
      '/home/alex/Projects/Koinkat/src-tauri/target/debug/assistant/koinkat-mcp.mjs',
    ]) {
      expect(ok(VALIDATORS.bundle, p), p).toBe(true);
    }
    for (const p of [
      '/home/alex/Downloads/koinkat-mcp.mjs',
      '/home/alex/Documents/assistant/koinkat-mcp.mjs',
      '/usr/lib/Koinkat/../../../home/alex/Downloads/koinkat-mcp.mjs',
      '/home/alex/Downloads/src-tauri/target/debug/assistant/koinkat-mcp.mjs',
    ]) {
      expect(ok(VALIDATORS.bundle, p), p).toBe(false);
    }
  });

  it('accepts Windows paths inside the Claude JSON config and rejects a foreign command', () => {
    expect(ok(VALIDATORS.claudeMcpConfig, claudeMcpConfigJson(windows))).toBe(true);
    expect(ok(VALIDATORS.claudeMcpConfig, claudeMcpConfigJson({ ...posix, nodePath: '/home/alex/Downloads/evil' }))).toBe(false);
  });
});


describe('http scope', () => {
  it('uses only URL patterns Tauri can parse (an invalid one breaks every fetch)', () => {
    const cap = buildAssistantCapability() as { permissions: ({ identifier?: string; allow?: { url?: string }[] } | string)[] };
    const http = cap.permissions.find((p) => typeof p !== 'string' && p.identifier === 'http:allow-fetch') as { allow: { url: string }[] };
    for (const { url } of http.allow) {
      // URLPattern host syntax: no brackets (IPv6 literals are rejected).
      expect(url).not.toMatch(/[[\]]/);
      expect(url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')).toBe(true);
    }
  });
});
