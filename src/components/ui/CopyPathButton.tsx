import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './Button';

/**
 * Copies a local folder path to the clipboard.
 *
 * Why not a button that opens the folder: the shell plugin's `open` accepts
 * only https/mailto/tel URLs under its default scope, so a folder path is
 * refused - the "Open data folder" button that used to sit on the boot-error
 * screen silently did nothing in every release build. Widening that scope to
 * local paths would also let the webview launch executables. Opening a folder
 * properly needs tauri-plugin-opener's scoped reveal; until then, copying the
 * path is the honest version of the feature.
 */
export function CopyPathButton({
  path,
  label = 'Copy folder path',
  variant = 'secondary',
}: {
  path: string;
  label?: string;
  variant?: 'secondary' | 'ghost';
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  }

  return (
    <Button variant={variant} onClick={() => void copy()}>
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : label}
    </Button>
  );
}
