/**
 * Where to put a dropdown panel so it stays inside the window.
 *
 * Pure geometry, no DOM: the caller measures the trigger and the viewport
 * and applies the result with `position: fixed`. Opens below the trigger
 * when the panel fits there; otherwise on whichever side has more room,
 * with its height capped to that room, so it never runs off-screen.
 */

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PanelOptions {
  /** Height the panel would like (its natural height, capped by the caller). */
  desiredHeight: number;
  /** Narrowest the panel may be, even under a narrow trigger. */
  minWidth?: number;
  /** Gap kept between the panel and the window edges. */
  margin?: number;
  /** Gap between the trigger and the panel. */
  offset?: number;
}

export interface PanelPosition {
  placement: 'below' | 'above';
  /** `top` for a panel below the trigger, `bottom` for one above it. */
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function computePanelPosition(
  anchor: AnchorRect,
  viewport: Viewport,
  options: PanelOptions,
): PanelPosition {
  const margin = options.margin ?? 8;
  const offset = options.offset ?? 4;

  const spaceBelow = viewport.height - anchor.bottom - offset - margin;
  const spaceAbove = anchor.top - offset - margin;
  // Below when the whole panel fits there; otherwise the roomier side.
  const placement: PanelPosition['placement'] =
    spaceBelow >= options.desiredHeight || spaceBelow >= spaceAbove ? 'below' : 'above';
  const room = Math.max(0, placement === 'below' ? spaceBelow : spaceAbove);
  // Capped to the room on that side: the list inside scrolls instead of
  // the panel running past the window edge.
  const maxHeight = Math.min(options.desiredHeight, room);

  // As wide as the trigger (at least minWidth), never wider than the window,
  // and slid left if it would overflow the right edge.
  const available = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(Math.max(anchor.width, options.minWidth ?? 0), available);
  const left = Math.min(
    Math.max(anchor.left, margin),
    Math.max(margin, viewport.width - margin - width),
  );

  return placement === 'below'
    ? { placement, top: anchor.bottom + offset, left, width, maxHeight }
    : { placement, bottom: viewport.height - anchor.top + offset, left, width, maxHeight };
}

/** True when no part of the trigger is inside the window any more. */
export function isAnchorOutOfView(anchor: AnchorRect, viewport: Viewport): boolean {
  return anchor.bottom < 0 || anchor.top > viewport.height;
}
