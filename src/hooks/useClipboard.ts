import { useState, useCallback } from 'react';

export function useClipboard(timeout = 1500) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
      } catch {
        // Clipboard access denied or unavailable in this context
      }
    },
    [timeout],
  );

  return { copied, copy };
}
