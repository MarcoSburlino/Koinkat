import { useEffect, useState } from 'react';
import { CircleAlert, RotateCcw, UserPlus, Download, LifeBuoy } from 'lucide-react';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { CopyPathButton } from '../ui/CopyPathButton';
import type { BootErrorKind } from '../../lib/boot-failure';
import { LATEST_RELEASE_URL } from '../../lib/constants';
import { BackupRestorePanel } from '../BackupRestorePanel';
import type { BackupFile, RestoreResult } from '../../services/backup-service';

/** What the user types to arm "Start fresh". Compared case-insensitively. */
const START_FRESH_PHRASE = 'start fresh';

/** Heading and explanation per kind (see lib/boot-failure.ts for the kinds). */
const COPY: Record<BootErrorKind, { title: string; body: string }> = {
  readFailed: {
    title: 'Koinkat could not open your data',
    body:
      'Nothing has been deleted. Your database file is still on this device - ' +
      'the app just could not read it this time. This usually clears up on a ' +
      'retry.',
  },
  newerVersion: {
    title: 'Your data needs a newer version of Koinkat',
    body:
      'Nothing has been deleted. A newer version of Koinkat has already ' +
      'opened this database and updated it, and this older version cannot ' +
      'read the result. Install the latest version and your data opens as ' +
      'before. On Windows, "winget upgrade MarcoSburlino.Koinkat" does it too.',
  },
  noUsers: {
    title: 'Koinkat found no users in its database',
    body:
      'The database opened, but it contains no users, even though Koinkat ' +
      'has been set up on this device before.',
  },
  orphanedData: {
    title: 'Koinkat found your data, but not who it belongs to',
    body:
      'Your workspaces are still in the database, but the user they belong ' +
      'to is missing from it, so there is no one to open them as. Recover ' +
      'puts that user back and everything opens as before. Nothing is ' +
      'deleted or changed.',
  },
};

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
 * So nothing here leads to registration by accident. The one route there is
 * "Start fresh", offered only for `noUsers` and only behind a typed
 * confirmation. It exists because a user who deleted the data folder on
 * purpose would otherwise be locked on this screen forever: the database
 * goes, but the webview profile holding the "set up before" breadcrumb lives
 * in a different folder and stays. Start fresh deletes nothing.
 *
 * Before Start fresh, `noUsers` offers Koinkat's own backups
 * (BackupRestorePanel), and `orphanedData` offers only Recover: if the user
 * has data, the app finds it before it ever offers to start again.
 */
export function BootError({
  kind,
  message,
  actionError,
  onRetry,
  onStartFresh,
  onRecover,
  onRestored,
  retrying,
}: {
  kind: BootErrorKind;
  message: string;
  /** A failed action taken on this screen (Recover), shown above the buttons. */
  actionError?: string | null;
  onRetry: () => void;
  onStartFresh: () => void;
  onRecover: () => void;
  onRestored: (result: RestoreResult, backup: BackupFile) => void;
  retrying: boolean;
}) {
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbDir, setDbDir] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState('');

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

  const noUsers = kind === 'noUsers';
  const emptyRead = kind === 'noUsers' || kind === 'orphanedData';
  const phraseMatches = phrase.trim().toLowerCase() === START_FRESH_PHRASE;

  function closeConfirm() {
    setConfirmOpen(false);
    setPhrase('');
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-6"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <Card className="w-full max-w-xl flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <CircleAlert
            size={18}
            className="mt-[2px] shrink-0"
            style={{ color: kind === 'readFailed' ? 'var(--danger)' : 'var(--warning)' }}
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold">{COPY[kind].title}</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {COPY[kind].body}
            </p>
          </div>
        </div>

        {/* The raw error, for bug reports. The empty-read kinds have no raw
            error - their message is the paragraph above - so repeating it
            would only add noise. */}
        {!emptyRead && (
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
        )}

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

        {noUsers && <BackupRestorePanel onRestored={onRestored} />}

        {actionError && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {actionError}
          </p>
        )}

        {noUsers && (
          <div className="flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <p>
              <strong style={{ color: 'var(--text)' }}>Not expecting this?</strong>{' '}
              Do not set anything up yet. Check that the file above is the one
              you use, then retry. To restore a backup file of your own, close
              Koinkat and copy it over that file.
            </p>
            <p>
              <strong style={{ color: 'var(--text)' }}>
                Removed your data on purpose?
              </strong>{' '}
              If you deleted Koinkat's data folder to start over, Start
              fresh takes you to setting up a new user. It deletes nothing.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {kind === 'orphanedData' ? (
            <Button onClick={onRecover} disabled={retrying}>
              <LifeBuoy size={14} /> {retrying ? 'Recovering…' : 'Recover my data'}
            </Button>
          ) : kind === 'newerVersion' ? (
            // Retrying can never help here, so it is not offered.
            <Button
              onClick={() => {
                void openUrl(LATEST_RELEASE_URL).catch(() => {
                  /* the body text names the fix; the link is a convenience */
                });
              }}
            >
              <Download size={14} /> Get the latest version
            </Button>
          ) : (
            <Button onClick={onRetry} disabled={retrying}>
              <RotateCcw size={14} /> {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
          {dbDir && <CopyPathButton path={dbDir} />}
          {noUsers && (
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={retrying}
            >
              <UserPlus size={14} /> Start fresh…
            </Button>
          )}
        </div>

        {kind === 'readFailed' && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            If this keeps happening, close Koinkat, copy that file somewhere safe
            as a backup, then reopen the app. Koinkat also keeps daily backups
            of it in the backups folder next to it, and if you restored one of
            those, the database it replaced sits beside it as
            koinkat-replaced-(date).db.
          </p>
        )}
      </Card>

      <Modal open={confirmOpen} onClose={closeConfirm} title="Start fresh?">
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Koinkat will forget that it was set up on this device and take you
          to creating a new user. Nothing is deleted.{' '}
          <strong style={{ color: 'var(--text)' }}>
            Only continue if you removed your Koinkat data on purpose.
          </strong>{' '}
          If you expected your accounts to be here, cancel and use Retry
          instead.
        </p>
        <div className="mb-4">
          <Input
            label={`Type "${START_FRESH_PHRASE}" to confirm`}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={START_FRESH_PHRASE}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={closeConfirm} disabled={retrying}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              closeConfirm();
              onStartFresh();
            }}
            disabled={retrying || !phraseMatches}
          >
            Start fresh
          </Button>
        </div>
      </Modal>
    </div>
  );
}
