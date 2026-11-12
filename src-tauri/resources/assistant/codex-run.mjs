// Koinkat assistant: start Codex with stdin CLOSED.
//
// `codex exec` reads a piped stdin until end-of-input (it appends it to the
// prompt), and the Tauri shell plugin can never close a child's stdin, so
// Codex started directly would wait forever. This launcher only re-spawns
// its arguments with stdin ignored and copies the output back.
//
// It adds nothing: the program (one of the known Codex paths) and every
// flag after "--" are pinned by src-tauri/capabilities/assistant.json,
// generated from src/assistant/programs.ts.
//
// Usage: node codex-run.mjs <codex path> -- exec ...
import { spawn } from 'node:child_process';

const [codex, sep, ...args] = process.argv.slice(2);
if (!codex || sep !== '--' || args[0] !== 'exec') {
  process.stderr.write('codex-run: expected <codex> -- exec ...\n');
  process.exit(2);
}
const child = spawn(codex, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('error', (e) => {
  process.stderr.write(`codex-run: ${e.message}\n`);
  process.exit(1);
});
child.on('close', (code) => process.exit(code ?? 1));
// If Koinkat stops the turn and this launcher is killed, Codex loses its
// output pipe; also forward ordinary termination signals.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => child.kill(sig));
}
