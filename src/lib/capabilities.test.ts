/**
 * Every file operation the backup service performs must be granted
 * explicitly in the Tauri capability file.
 *
 * Why this exists: 0.1.5 shipped with automatic backups that could not run.
 * `backup-service.ts` calls `exists` and `readDir` on `$APPCONFIG/backups`,
 * and those were expected to come from `fs:default`. They don't: in
 * tauri-plugin-fs 2.5.1, `read-app-specific-dirs-recursive` lists
 * `scope-app-recursive` under `commands.allow` instead of as a scope, so the
 * commands are allowed with NO path in scope, and every call failed with
 * "forbidden path". The in-memory fs in `backup-service.test.ts` cannot see
 * this; only the real capability file can.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPABILITY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src-tauri',
  'capabilities',
  'default.json',
);

type Permission = string | { identifier: string; allow?: { path?: string }[] };

const permissions: Permission[] = JSON.parse(readFileSync(CAPABILITY, 'utf8')).permissions;

function allowedPaths(identifier: string): string[] {
  return permissions
    .filter((p): p is Exclude<Permission, string> => typeof p !== 'string' && p.identifier === identifier)
    .flatMap((p) => (p.allow ?? []).map((a) => a.path ?? ''));
}

describe('backup file permissions', () => {
  it.each([
    // [command permission, path the backup service touches]
    ['fs:allow-exists', '$APPCONFIG/backups'],
    ['fs:allow-exists', '$APPCONFIG/backups/*'],
    ['fs:allow-exists', '$APPCONFIG/koinkat.db'],
    ['fs:allow-exists', '$APPCONFIG/koinkat.db-wal'],
    ['fs:allow-exists', '$APPCONFIG/koinkat.db-shm'],
    ['fs:allow-read-dir', '$APPCONFIG/backups'],
    ['fs:allow-mkdir', '$APPCONFIG/backups'],
    ['fs:allow-remove', '$APPCONFIG/backups/*'],
    ['fs:allow-rename', '$APPCONFIG/backups/*'],
    ['fs:allow-rename', '$APPCONFIG/koinkat.db'],
    ['fs:allow-rename', '$APPCONFIG/koinkat-replaced-*'],
    ['fs:allow-copy-file', '$APPCONFIG/backups/*'],
    ['fs:allow-copy-file', '$APPCONFIG/koinkat.db'],
  ])('%s covers %s', (identifier, path) => {
    expect(allowedPaths(identifier)).toContain(path);
  });

  it('keeps the global fs scope away from the app data folders', () => {
    // A global $APPCONFIG/** or $APPLOCALDATA/** grant would open the whole
    // database folder (and on Linux collide with the webview-data deny).
    const global = allowedPaths('fs:scope');
    expect(global.some((p) => p.startsWith('$APP'))).toBe(false);
  });
});
