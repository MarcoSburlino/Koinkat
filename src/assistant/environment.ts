/**
 * Finds the programs the assistant can use and the paths it passes to
 * them. Everything here goes through the scoped shell entries generated
 * from programs.ts - there is no other way to start a process.
 */
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { appConfigDir, appLocalDataDir, homeDir, join, resolveResource } from '@tauri-apps/api/path';
import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { PROGRAM_PATHS, scopeName, type ProgramKind } from './programs';

export interface FoundProgram {
  /** Index into PROGRAM_PATHS[kind] - selects the scope entry. */
  index: number;
  /** Absolute path (with $HOME expanded). */
  path: string;
  version: string;
}

export interface AssistantEnvironment {
  claude: FoundProgram | null;
  codex: FoundProgram | null;
  /** Node >= 22.13, needed to run the Koinkat data server. */
  node: FoundProgram | null;
  /** A Node was found but is too old (shown in Settings). */
  nodeTooOld: string | null;
  bundlePath: string;
  /** Starts Codex with stdin closed (resources/assistant/codex-run.mjs). */
  codexLauncherPath: string;
  dbPath: string;
  workdir: string;
}

const MIN_NODE: [number, number] = [22, 13];

export function nodeVersionOk(version: string): boolean {
  const m = /v?(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1]);
}

/** Run a scoped command to completion and collect its output. */
export function runCollect(
  name: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child: Child | null = null;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      void child?.kill().catch(() => {});
      finish(null);
    }, opts.timeoutMs ?? 15_000);
    const cmd = Command.create(name, args, opts.cwd ? { cwd: opts.cwd } : undefined);
    cmd.stdout.on('data', (d) => (stdout += d + '\n'));
    cmd.stderr.on('data', (d) => (stderr += d + '\n'));
    cmd.on('close', (e) => finish(e.code));
    cmd.on('error', (e) => {
      stderr += String(e);
      finish(null);
    });
    cmd
      .spawn()
      .then((c) => (child = c))
      .catch((e: unknown) => {
        stderr += String(e);
        finish(null);
      });
  });
}

async function findProgram(kind: ProgramKind, home: string): Promise<FoundProgram | null> {
  const paths = PROGRAM_PATHS[kind];
  for (let i = 0; i < paths.length; i++) {
    const r = await runCollect(scopeName(kind, i, 'version'), ['--version'], { timeoutMs: 8_000 });
    if (r.code === 0 && r.stdout.trim()) {
      return {
        index: i,
        path: paths[i].replace('$HOME', home.replace(/[\\/]+$/, '')),
        version: r.stdout.trim().split('\n')[0],
      };
    }
  }
  return null;
}

let cached: Promise<AssistantEnvironment> | null = null;

/** Detect programs and paths (cached; pass `refresh` after installing something). */
export function detectEnvironment(refresh = false): Promise<AssistantEnvironment> {
  if (!cached || refresh) {
    cached = (async () => {
      const home = await homeDir();
      const [claude, codex] = await Promise.all([findProgram('claude', home), findProgram('codex', home)]);
      // Node candidates in order; keep the first NEW enough one.
      let node: FoundProgram | null = null;
      let nodeTooOld: string | null = null;
      const paths = PROGRAM_PATHS.node;
      for (let i = 0; i < paths.length && !node; i++) {
        const r = await runCollect(scopeName('node', i, 'version'), ['--version'], { timeoutMs: 8_000 });
        if (r.code !== 0) continue;
        const version = r.stdout.trim();
        if (nodeVersionOk(version)) {
          node = { index: i, path: paths[i].replace('$HOME', home.replace(/[\\/]+$/, '')), version };
        } else {
          nodeTooOld ??= version;
        }
      }
      const workdir = await join(await appLocalDataDir(), 'assistant-workdir');
      try {
        if (!(await exists(workdir))) await mkdir(workdir, { recursive: true });
      } catch (e) {
        console.warn('[assistant] could not create the working folder:', e);
      }
      return {
        claude,
        codex,
        node,
        nodeTooOld: node ? null : nodeTooOld,
        bundlePath: await resolveResource('assistant/koinkat-mcp.mjs'),
        codexLauncherPath: await resolveResource('assistant/codex-run.mjs'),
        dbPath: await join(await appConfigDir(), 'koinkat.db'),
        workdir,
      };
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
