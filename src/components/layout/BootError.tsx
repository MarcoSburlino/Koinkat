import { useEffect, useState } from 'react';
import { AlertCircle, RotateCcw, FolderOpen } from 'lucide-react';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

/**
 * Shown when bootstrap() could not read the database, or read back zero users
 * on a device that has been set up before.
 *
 * The rule this screen exists to enforce: a FAILED read and an EMPTY read must
 * never collapse into the same UI state when the empty state is destructive to
 * offer. Previously both rendered the first-run "create a user" form, so a
 * transient lock after a Windows restart looked exactly like a fresh install -
 * and registering from there would have orphaned the real workspace behind a
 * second user row.
 *
 * So: no registration affordance anywhere on this screen. Only Retry.
 */
export function BootError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbDir, setDbDir] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dir = await appConfigDir();
        const file = await join(dir, 'koinkat.db');
        if (cancelled) return;
        setDbDir(dir);
        setDbPath(file);
      } catch {
        /* path resolution is best-effort - the rest of the screen still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-6"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <Card className="w-full max-w-xl flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <AlertCircle
            size={18}
            className="mt-[2px] shrink-0"
            style={{ color: 'var(--danger)' }}
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold">
              Koinkat could not open your data
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Nothing has been deleted. Your database file is still on this
              device - the app just could not read it this time. This usually
              clears up on a retry.
            </p>
          </div>
        </div>

        <div
          className="rounded p-3 text-xs font-mono break-all"
          style={{
            backgroundColor: 'var(--surface-2)',
            color: 'var(--text-muted)',
            borderRadius: 'var(--radius-1)',
          }}
        >
          {message}
        </div>

        {dbPath && (
          <div className="flex flex-col gap-1">
            <span
              className="text-xs uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              Database file
            </span>
            <span className="text-xs font-mono break-all">{dbPath}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={onRetry} disabled={retrying}>
            <RotateCcw size={14} /> {retrying ? 'Retrying…' : 'Retry'}
          </Button>
          {dbDir && (
            <Button
              variant="secondary"
              onClick={() => {
                void openPath(dbDir).catch(() => {
                  /* opening the folder is a convenience, not a requirement */
                });
              }}
            >
              <FolderOpen size={14} /> Open data folder
            </Button>
          )}
        </div>

        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          If this keeps happening, close Koinkat, copy that file somewhere safe
          as a backup, then reopen the app.
        </p>
      </Card>
    </div>
  );
}
