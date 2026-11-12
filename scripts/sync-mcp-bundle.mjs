#!/usr/bin/env node
/**
 * Build the read-only Koinkat MCP server (`mcp/`) into one file and copy it
 * into the app's resources, with the licence notices of what it inlines.
 *
 *   npm run mcp:bundle            # build + copy
 *   npm run mcp:bundle -- --check # build + fail if the committed copy differs
 *
 * The copy is committed so a release build needs no extra step; `--check`
 * (run in CI) keeps it from drifting from the source. esbuild output is
 * deterministic for the same lockfile, so a byte comparison is enough.
 */
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mcp = join(root, 'mcp');
const outDir = join(root, 'src-tauri', 'resources', 'assistant');
const checkOnly = process.argv.includes('--check');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(join(mcp, 'node_modules'))) {
  execFileSync(npm, ['ci'], { cwd: mcp, stdio: 'inherit', shell: process.platform === 'win32' });
}
execFileSync(npm, ['run', 'bundle'], { cwd: mcp, stdio: 'inherit', shell: process.platform === 'win32' });

const files = [
  ['koinkat-mcp.mjs', 'koinkat-mcp.mjs'],
  ['THIRD-PARTY-NOTICES.md', 'koinkat-mcp-NOTICES.md'],
];

if (checkOnly) {
  const stale = files.filter(([from, to]) => {
    const target = join(outDir, to);
    return !existsSync(target) || !readFileSync(join(mcp, 'dist', from)).equals(readFileSync(target));
  });
  if (stale.length) {
    console.error(
      `Out of date with mcp/: ${stale.map(([, to]) => to).join(', ')}.\n` +
        'Run `npm run mcp:bundle` and commit the result.',
    );
    process.exit(1);
  }
  console.log('The MCP bundle in src-tauri/resources/assistant is up to date.');
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [from, to] of files) copyFileSync(join(mcp, 'dist', from), join(outDir, to));
  console.log(`Copied the MCP bundle and notices into ${outDir}`);
}
