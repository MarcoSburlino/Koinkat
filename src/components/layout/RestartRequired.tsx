import { format } from 'date-fns';
import { CircleCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import type { BackupFile, RestoreResult } from '../../services/backup-service';

/**
 * Shown after a backup has been restored. Terminal for this process: the
 * database is closed, and it must be reopened by a fresh start, because
 * tauri-plugin-sql only runs migrations on the first load in a process (see
 * closeDb in src/db/database.ts). Loading the restored file now would skip
 * them, so this screen offers nothing to click that could.
 */
export function RestartRequired({
  result,
  backup,
}: {
  result: RestoreResult;
  backup: BackupFile;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-6"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <Card className="w-full max-w-xl flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <CircleCheck
            size={18}
            className="mt-[2px] shrink-0"
            style={{ color: 'var(--primary)' }}
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold">Backup restored</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              The backup from {format(backup.takenAt, 'd MMM yyyy, HH:mm')} is
              now your database.{' '}
              <strong style={{ color: 'var(--text)' }}>
                Close Koinkat and open it again
              </strong>{' '}
              to finish: the restored data is brought up to date for this
              version as the app starts.
            </p>
          </div>
        </div>
        {result.setAsideAs && (
          <div className="flex flex-col gap-1">
            <span
              className="text-xs uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              The database it replaced was kept as
            </span>
            <span className="text-xs font-mono break-all">{result.setAsideAs}</span>
          </div>
        )}
      </Card>
    </div>
  );
}
