/**
 * The external programs the assistant may start, and the EXACT argument
 * lists it may start them with. This file is the single source of truth
 * for `src-tauri/capabilities/assistant.json`: `capability.test.ts`
 * regenerates/compares that file from `buildAssistantCapability()`, so
 * the webview can only ever run these programs with these flags.
 *
 * How the Tauri shell scope works (tauri-plugin-shell 2.3.5, scope.rs):
 * every scope entry pins one program path; each argument position is
 * either a FIXED string (taken from the capability, whatever the webview
 * passes) or a value checked against an anchored regex. So the lockdown
 * flags below (`--restricted`, `--tools ""`, `--disable shell_tool`, ...)
 * cannot be dropped or reordered by the app at runtime.
 *
 * Threat model: a compromised webview. It may call any scoped command
 * with any values the validators accept, and it can write files into
 * Downloads / Desktop / Documents (the export scope). Therefore:
 * - an executable path in an ARGUMENT (Node inside the Claude/Codex MCP
 *   config, Codex for the launcher) must be one of the known install
 *   paths below, never "any absolute path";
 * - a script Node runs (the MCP bundle, the Codex launcher) must sit in
 *   an app INSTALL folder, which the webview cannot write to.
 *
 * Verified 2026-11-12 with Claude Code 2.1.322 and codex-cli 0.167.2 on a
 * fictional database: the Claude session exposes only the ten Koinkat
 * tools; Codex with `--disable shell_tool` cannot run commands.
 */

export type ProgramKind = 'claude' | 'codex' | 'node';

/** Where each program is looked for, in order. `$HOME` is expanded by Tauri. */
export const PROGRAM_PATHS: Record<ProgramKind, readonly string[]> = {
  claude: [
    '$HOME/.local/bin/claude',
    '$HOME/.claude/local/claude',
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
    '$HOME/.local/bin/claude.exe',
  ],
  codex: [
    '$HOME/.local/bin/codex',
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/bin/codex',
    '$HOME/.cargo/bin/codex',
  ],
  node: [
    '/usr/bin/node',
    '/usr/bin/node-22',
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '$HOME/.local/bin/node',
    'C:\\Program Files\\nodejs\\node.exe',
  ],
};

// ── Argument validators (Rust regex; the plugin anchors them ^...$) ───
//
// Quantifiers are unbounded on purpose: Rust's regex crate expands a
// bounded repeat of a Unicode class (`[^\x00]{0,120000}`) into a program
// over its size limit, and the shell plugin PANICS on a bad pattern at
// startup. Lengths are enforced in `fillArgs` (MAX_ARG_CHARS) instead.

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex pieces for a path written plainly (argv) or inside a JSON string
 * (the Claude `--mcp-config`), where every backslash is doubled.
 */
function pathTokens(inJson: boolean) {
  return inJson
    ? { BS: String.raw`\\\\`, SEP: String.raw`(?:/|\\\\)` }
    : { BS: String.raw`\\`, SEP: String.raw`[/\\]` };
}

/** One path segment: no separators, quotes, NUL or newline. */
const SEG = String.raw`[^/\\"'\x00\n]+`;

/** What `$HOME` expands to on each OS. */
function homeRe(inJson: boolean): string {
  const { BS } = pathTokens(inJson);
  return `(?:/home/${SEG}|/Users/${SEG}|/root|[A-Za-z]:${BS}Users${BS}${SEG})`;
}

/** Exact program paths for `kind`, `$HOME` widened to any user's home. */
function programPathRe(kind: ProgramKind, inJson: boolean): string {
  const { BS, SEP } = pathTokens(inJson);
  const alts = PROGRAM_PATHS[kind].map((p) =>
    p
      .split('$HOME')
      .map((part) =>
        part
          .split(/([/\\])/)
          .map((tok) => (tok === '/' ? (p.includes('$HOME') ? SEP : '/') : tok === '\\' ? BS : reEscape(tok)))
          .join(''),
      )
      .join(homeRe(inJson)),
  );
  return `(?:${alts.join('|')})`;
}

/**
 * Folders an INSTALLED app's resources live in (root/admin-owned or the
 * app's own per-user install dir), plus the dev build output. The webview
 * has no write access to any of them. A segment like `<app>` covers
 * "Koinkat" and "Koinkat Demo".
 */
function installDirRe(inJson: boolean): string {
  const { BS, SEP } = pathTokens(inJson);
  return `(?:${[
    `/usr/lib/${SEG}/assistant/`,
    `/usr/lib64/${SEG}/assistant/`,
    `/opt/${SEG}/assistant/`,
    `/tmp/\\.mount_${SEG}/usr/lib/${SEG}/assistant/`,
    `/Applications/${SEG}\\.app/Contents/Resources/assistant/`,
    `/Users/${SEG}/Applications/${SEG}\\.app/Contents/Resources/assistant/`,
    `[A-Za-z]:${BS}Program Files${BS}${SEG}${BS}assistant${BS}`,
    `[A-Za-z]:${BS}Users${BS}${SEG}${BS}AppData${BS}Local${BS}(?:Programs${BS})?${SEG}${BS}assistant${BS}`,
    // Local debug/release builds of a checkout named Koinkat. The webview
    // can write files into Downloads/Desktop/Documents but cannot create
    // folders there, so it cannot fake this nested path.
    `(?:/|[A-Za-z]:${BS})(?:${SEG}${SEP})*[Kk]oinkat${SEP}src-tauri${SEP}target${SEP}(?:debug|release)${SEP}assistant${SEP}`,
  ].join('|')})`;
}

function installedScriptRe(file: string, inJson: boolean): string {
  return `${installDirRe(inJson)}${reEscape(file)}`;
}

/** Any absolute path (POSIX or Windows drive), no quotes, NUL or newlines. */
const ABS = String.raw`(?:/|[A-Za-z]:\\)[^\x00"'\n]*`;
const ABS_IN_JSON = String.raw`(?:/|[A-Za-z]:\\\\)[^\x00"'\n]*`;
const UUID = '[0-9a-fA-F-]{36}';
const DB = `${ABS}koinkat\\.db`;
const DB_J = `${ABS_IN_JSON}koinkat\\.db`;
const NODE = programPathRe('node', false);
const NODE_J = programPathRe('node', true);
const CODEX = programPathRe('codex', false);
const BUNDLE = installedScriptRe('koinkat-mcp.mjs', false);
const BUNDLE_J = installedScriptRe('koinkat-mcp.mjs', true);
const LAUNCHER = installedScriptRe('codex-run.mjs', false);
/** Free text that cannot be read as a flag: must start with a letter. */
const TEXT = '(?s)[A-Za-z][^\\x00]*';
const MODEL = String.raw`[A-Za-z0-9][A-Za-z0-9._:/\-\[\]]{0,63}`;

export const VALIDATORS = {
  absPath: ABS,
  node: NODE,
  codex: CODEX,
  bundle: BUNDLE,
  launcher: LAUNCHER,
  db: DB,
  uuid: UUID,
  model: MODEL,
  systemPrompt: TEXT,
  codexPrompt: TEXT,
  claudeMcpConfig:
    String.raw`\{"mcpServers":\{"koinkat":\{"command":"` + NODE_J +
    String.raw`","args":\["` + BUNDLE_J + String.raw`","--database","` + DB_J +
    String.raw`","--workspace","` + UUID + String.raw`"\]\}\}\}`,
  codexMcpCommand: `mcp_servers\\.koinkat\\.command='${NODE}'`,
  codexMcpArgs:
    `mcp_servers\\.koinkat\\.args=\\['${BUNDLE}', '--database', '${DB}', '--workspace', '${UUID}'\\]`,
} as const;

type Arg = string | { validator: string };
const v = (validator: string): Arg => ({ validator });

/**
 * Codex's own argv for one chat turn. It is NOT run directly: `codex exec`
 * waits for end-of-input on a piped stdin, and the Tauri shell plugin can
 * never close a child's stdin. So the shipped launcher (`codex-run.mjs`)
 * starts Codex with stdin closed, and the capability pins these flags as
 * the launcher's arguments (see `node.codex-run`).
 */
export const CODEX_EXEC_ARGS: Arg[] = [
  'exec',
  '--json',
  '--ephemeral',
  '--skip-git-repo-check',
  '--ignore-user-config',
  '--ignore-rules',
  '-s',
  'read-only',
  '-C',
  v(ABS),
  '--disable',
  'shell_tool',
  '--disable',
  'browser_use',
  '--disable',
  'computer_use',
  '--disable',
  'in_app_browser',
  '--disable',
  'apps',
  '-c',
  'approval_policy="never"',
  '-c',
  v(VALIDATORS.codexMcpCommand),
  '-c',
  v(VALIDATORS.codexMcpArgs),
  v(VALIDATORS.codexPrompt),
];

/** Patterns a program may be run with. Order = argument positions. */
export const ARG_PATTERNS: Record<ProgramKind, Record<string, Arg[]>> = {
  claude: {
    version: ['--version'],
    run: [
      '-p',
      '--restricted',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      v(VALIDATORS.claudeMcpConfig),
      '--allowedTools',
      'mcp__koinkat',
      '--model',
      v(VALIDATORS.model),
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--no-session-persistence',
      '--system-prompt',
      v(VALIDATORS.systemPrompt),
    ],
    'mcp-add': [
      'mcp', 'add', '--scope', 'user', 'koinkat', '--',
      v(NODE), v(BUNDLE), '--database', v(DB), '--workspace', v(UUID),
    ],
    'mcp-remove': ['mcp', 'remove', 'koinkat', '--scope', 'user'],
  },
  codex: {
    version: ['--version'],
    'mcp-add': [
      'mcp', 'add', 'koinkat', '--',
      v(NODE), v(BUNDLE), '--database', v(DB), '--workspace', v(UUID),
    ],
    'mcp-remove': ['mcp', 'remove', 'koinkat'],
  },
  node: {
    version: ['--version'],
    mcp: [v(BUNDLE), '--database', v(DB), '--workspace', v(UUID)],
    'codex-run': [v(LAUNCHER), v(CODEX), '--', ...CODEX_EXEC_ARGS],
  },
};

/** Scope entry name for program `kind`, candidate path `i`, pattern `p`. */
export function scopeName(kind: ProgramKind, i: number, pattern: string): string {
  return `kk-assistant-${kind}-${i}-${pattern}`;
}

/** The generated contents of `src-tauri/capabilities/assistant.json`. */
export function buildAssistantCapability(): unknown {
  const allow: unknown[] = [];
  for (const kind of Object.keys(PROGRAM_PATHS) as ProgramKind[]) {
    PROGRAM_PATHS[kind].forEach((cmd, i) => {
      for (const [pattern, args] of Object.entries(ARG_PATTERNS[kind])) {
        allow.push({ name: scopeName(kind, i, pattern), cmd, args });
      }
    });
  }
  return {
    $schema: '../gen/schemas/desktop-schema.json',
    identifier: 'assistant',
    description:
      'Opt-in AI assistant: run the user\'s Claude Code / Codex CLI or Node (for the read-only Koinkat MCP server) with fixed, locked-down arguments, and reach a LOCAL model endpoint. GENERATED from src/assistant/programs.ts - edit that file and run UPDATE_ASSISTANT_CAPABILITY=1 npx vitest run src/assistant/capability.test.ts',
    windows: ['main'],
    permissions: [
      { identifier: 'shell:allow-spawn', allow },
      'shell:allow-stdin-write',
      'shell:allow-kill',
      {
        identifier: 'http:allow-fetch',
        allow: [
          { url: 'http://127.0.0.1:*/**' },
          { url: 'http://localhost:*/**' },
          // No IPv6 [::1]: URLPattern rejects the bracketed host, and an
          // invalid pattern breaks EVERY http fetch in the app (bank, FX).
        ],
      },
      {
        identifier: 'fs:allow-mkdir',
        allow: [{ path: '$APPLOCALDATA/assistant-workdir' }],
      },
      {
        identifier: 'fs:allow-exists',
        allow: [{ path: '$APPLOCALDATA/assistant-workdir' }],
      },
    ],
  };
}

/**
 * Longest single argument. Linux caps one argv string at 128 KiB
 * (MAX_ARG_STRLEN); stay well under it. The chat history sent with a
 * turn is trimmed to fit (see prompt.ts).
 */
export const MAX_ARG_CHARS = 100_000;

/** Concrete argv for a pattern: fixed strings as-is, validated slots filled in order. */
export function fillArgs(kind: ProgramKind, pattern: string, values: string[]): string[] {
  const spec = ARG_PATTERNS[kind][pattern];
  if (!spec) throw new Error(`No ${kind} pattern "${pattern}"`);
  const out: string[] = [];
  let next = 0;
  for (const a of spec) {
    if (typeof a === 'string') {
      out.push(a);
    } else {
      if (next >= values.length) throw new Error(`Missing value ${next} for ${kind} ${pattern}`);
      const val = values[next++];
      if (val.length > MAX_ARG_CHARS) {
        throw new Error(`Value ${next - 1} for ${kind} ${pattern} is too long`);
      }
      if (!new RegExp(`^(?:${toJsRegex(a.validator)})$`).test(val)) {
        throw new Error(`Value ${next - 1} for ${kind} ${pattern} is not allowed`);
      }
      out.push(val);
    }
  }
  if (next !== values.length) throw new Error(`Too many values for ${kind} ${pattern}`);
  return out;
}

/** Rust regex -> JS RegExp source for the subset used above. */
export function toJsRegex(rust: string): string {
  // `(?s)` (dot matches newline) has no inline JS form; the patterns only
  // use it with `[^\x00]`, which already spans newlines, so drop it.
  return rust.replace(/^\(\?s\)/, '');
}
