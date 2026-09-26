import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/app-store';

/**
 * Run `reload` whenever the app signals that data changed underneath the
 * open page (`useAppStore.notifyDataChanged`, e.g. after a bank sync).
 *
 * Not on mount - the page's own load effect covers that. The latest
 * `reload` is always the one called, so it can close over current filters
 * without being a dependency. Pass a QUIET reload: one that neither blanks
 * the page nor resets its scroll or selection.
 */
export function useDataChanged(reload: () => void | Promise<void>): void {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const seen = useRef(dataVersion);

  useEffect(() => {
    if (seen.current === dataVersion) return;
    seen.current = dataVersion;
    void reloadRef.current();
  }, [dataVersion]);
}
