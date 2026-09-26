import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  computePanelPosition,
  isAnchorOutOfView,
  type PanelPosition,
} from '../../lib/floating-position';

interface FloatingPanelProps {
  open: boolean;
  /** The trigger the panel attaches to. */
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * Clicks inside this element don't count as "outside" - pass the picker's
   * wrapper, so its own trigger button can toggle the panel.
   */
  ignoreRef?: RefObject<HTMLElement | null>;
  /** Close request: outside click, Escape, or the page scrolled under it. */
  onDismiss: () => void;
  /** Tallest the panel gets when there is room. */
  maxHeight?: number;
  minWidth?: number;
  /**
   * The panel is a flex column: give fixed parts `shrink-0` and the list
   * `flex-1 min-h-0 overflow-y-auto` so the LIST scrolls when space is short.
   */
  children: ReactNode;
}

function samePosition(a: PanelPosition | null, b: PanelPosition): boolean {
  return (
    a !== null &&
    a.placement === b.placement &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.left === b.left &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}

/**
 * A dropdown panel that always stays inside the window.
 *
 * Rendered into `document.body` with `position: fixed`, so no scroll box or
 * Modal can clip it, and placed by `computePanelPosition`: below the trigger
 * when it fits, above when that side has more room. It re-measures when its
 * content changes (categories arriving, a search narrowing the list) and on
 * resize. The page never scrolls to show it; scrolling the page (or any box
 * around the trigger) closes it, like a native select, instead of leaving a
 * fixed panel floating away from its trigger. Scrolling the panel's own list
 * never reaches the page (`overscroll-behavior: contain` on the list).
 */
export function FloatingPanel({
  open,
  anchorRef,
  ignoreRef,
  onDismiss,
  maxHeight = 340,
  minWidth = 240,
  children,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPosition | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (isAnchorOutOfView(rect, viewport)) {
      onDismissRef.current();
      return;
    }
    // The content's own height, read from the children: the panel's box is
    // already capped, but each child's scrollHeight is its full content.
    const panel = panelRef.current;
    const natural = panel
      ? Array.from(panel.children).reduce(
          (sum, child) => sum + (child as HTMLElement).scrollHeight,
          2, // top + bottom border
        )
      : maxHeight;
    const next = computePanelPosition(rect, viewport, {
      desiredHeight: Math.min(natural, maxHeight),
      minWidth,
    });
    setPos((prev) => (samePosition(prev, next) ? prev : next));
  }, [anchorRef, maxHeight, minWidth]);

  // Measure before paint on open and after every render (content changes).
  useLayoutEffect(() => {
    if (open) update();
    else setPos(null);
  });

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const onScroll = (e: Event) => {
      // The panel's own list scrolling is not a page scroll.
      if (panelRef.current?.contains(e.target as Node)) return;
      onDismissRef.current();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (ignoreRef?.current?.contains(target)) return;
      onDismissRef.current();
    };
    // Capture phase on window: runs before a surrounding Modal's own
    // Escape handler, so Escape closes only this panel.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismissRef.current();
    };
    // Capture, so scrolling ANY ancestor (a modal body, a 420px list) counts.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, update, ignoreRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="rounded-lg overflow-hidden flex flex-col"
      style={{
        position: 'fixed',
        top: pos?.top,
        bottom: pos?.bottom,
        left: pos?.left ?? 0,
        width: pos?.width,
        maxHeight: pos?.maxHeight ?? maxHeight,
        // Hidden only for the very first measurement, before paint.
        visibility: pos ? 'visible' : 'hidden',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-3)',
        zIndex: 'var(--z-popover)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
