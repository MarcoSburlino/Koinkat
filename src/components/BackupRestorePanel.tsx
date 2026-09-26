import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { History } from 'lucide-react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { currentSchemaVersion } from '../db/database';
import { CopyPathButton } from './ui/CopyPathButton';
import {
  backupsDirectory,
  listBackups,
  restorableBackups,
  restoreBackup,
  type BackupFile,
  type RestoreResult,
} from '../services/backup-service';

const REASON_LABEL: Record<BackupFile['reason'], string> = {
  daily: 'daily backup',
  manual: 'backed up by hand',
  'before-delete': 'taken before a delete',
};

function describe(b: BackupFile): string {
  return `${format(b.takenAt, 'd MMM yyyy, HH:mm')} (${REASON_LABEL[b.reason]})`;
}

/**
 * Offers Koinkat's automatic backups back to the user. Only render this where
 * the open database has NO users (the boot "no users" screen, first-run
 * setup): that is what makes replacing the file safe - there is nothing in it
 * to lose, and even so it is moved aside rather than deleted.
 *
 * Renders nothing when there are no backups this build can open.
 */
export function BackupRestorePanel({
  onRestored,
}: {
  onRestored: (result: RestoreResult, backup: BackupFile) => void;
}) {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Listing failed: say so rather than render nothing. This panel only
  // appears when something is already wrong with the database, which is
  // exactly when a secondary read is likeliest to fail too.
  const [listError, setListError] = useState<{ message: string; dir: string | null } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [all, version] = await Promise.all([listBackups(), currentSchemaVersion()]);
        const usable = restorableBackups(all, version);
        if (cancelled) return;
        setBackups(usable);
        setSelected(usable[0]?.name ?? '');
      } catch (err) {
        console.warn('[backup] could not list backups:', err);
        const dir = await backupsDirectory().catch(() => null);
        if (cancelled) return;
        setListError({ message: err instanceof Error ? err.message : String(err), dir });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (listError) {
    return (
      <div className="flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <p>
          <strong style={{ color: 'var(--text)' }}>Koinkat could not check its backups.</strong>{' '}
          Retry may clear this. Any backups it has taken are in its backups folder;
          to restore one by hand, close Koinkat and copy it over the database
          file. ({listError.message})
        </p>
        {listError.dir && (
          <div>
            <CopyPathButton path={listError.dir} label="Copy backups folder path" variant="ghost" />
          </div>
        )}
      </div>
    );
  }

  if (backups.length === 0) return null;
  const backup = backups.find((b) => b.name === selected) ?? backups[0];

  async function handleRestore() {
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackup(backup);
      setConfirmOpen(false);
      onRestored(result, backup);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 p-4"
      style={{
        borderRadius: 'var(--radius-2)',
        border: '1px solid color-mix(in srgb, var(--primary) 35%, var(--border))',
        backgroundColor: 'color-mix(in srgb, var(--primary) 6%, var(--surface))',
      }}
    >
      <div className="flex items-start gap-2">
        <History size={16} className="mt-[2px] shrink-0" style={{ color: 'var(--primary)' }} />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Koinkat has a backup of your data
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            The newest is from {describe(backups[0])}. Restoring it brings back
            every user and workspace it contains.
          </p>
        </div>
      </div>

      {backups.length > 1 && (
        <Select
          label="Backup to restore"
          value={backup.name}
          onChange={(e) => setSelected(e.target.value)}
          options={backups.map((b) => ({ value: b.name, label: describe(b) }))}
          disabled={busy}
        />
      )}

      {error && (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div>
        <Button onClick={() => setConfirmOpen(true)} disabled={busy}>
          <History size={14} /> Restore this backup
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        title="Restore this backup?"
      >
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Koinkat will restore the backup from{' '}
          <strong style={{ color: 'var(--text)' }}>{describe(backup)}</strong>.
          Nothing is deleted: the current database, which has no users, is
          renamed and kept in the same folder, and the backup stays where it
          is.
        </p>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Afterwards you close Koinkat and open it again, so the restored data
          is brought up to date for this version.
        </p>
        {error && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleRestore()} disabled={busy}>
            {busy ? 'Restoring…' : 'Restore'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
