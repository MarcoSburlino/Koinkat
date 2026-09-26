import { describe, it, expect } from 'vitest';
import { computePanelPosition, isAnchorOutOfView } from './floating-position';

const VIEWPORT = { width: 1280, height: 800 };

/** A 44px-tall trigger, 288px wide, with its top edge at `top`. */
function trigger(top: number, left = 900, width = 288) {
  return { top, bottom: top + 44, left, width };
}

describe('computePanelPosition', () => {
  it('opens below when the panel fits there', () => {
    const pos = computePanelPosition(trigger(100), VIEWPORT, { desiredHeight: 340 });

    expect(pos.placement).toBe('below');
    expect(pos.top).toBe(148); // trigger bottom 144 + 4px gap
    expect(pos.bottom).toBeUndefined();
    expect(pos.maxHeight).toBe(340);
  });

  it('flips above a trigger near the bottom of the window', () => {
    // The last row of the Review queue: 60px of room below, lots above.
    const pos = computePanelPosition(trigger(700), VIEWPORT, { desiredHeight: 340 });

    expect(pos.placement).toBe('above');
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(104); // 800 - 700 + 4: its bottom edge hugs the trigger
    expect(pos.maxHeight).toBe(340);
  });

  it('stays below for a short list even near the bottom, when it fits', () => {
    const pos = computePanelPosition(trigger(600), VIEWPORT, { desiredHeight: 120 });

    expect(pos.placement).toBe('below');
  });

  it('caps the height to the room on the chosen side, so the list scrolls instead', () => {
    const small = { width: 1280, height: 400 };
    const pos = computePanelPosition(trigger(150), small, { desiredHeight: 340 });

    // 150 - 4 - 8 = 138 above, 400 - 194 - 4 - 8 = 194 below: below wins.
    expect(pos.placement).toBe('below');
    expect(pos.maxHeight).toBe(194);
  });

  it('slides left instead of running past the right edge', () => {
    const pos = computePanelPosition(trigger(100, 1100, 150), VIEWPORT, {
      desiredHeight: 340,
      minWidth: 240,
    });

    expect(pos.width).toBe(240);
    expect(pos.left).toBe(1280 - 8 - 240);
  });

  it('never starts left of the window or gets wider than it', () => {
    const narrow = { width: 300, height: 800 };
    const pos = computePanelPosition(trigger(100, -20, 400), narrow, { desiredHeight: 340 });

    expect(pos.left).toBe(8);
    expect(pos.width).toBe(284);
  });
});

describe('isAnchorOutOfView', () => {
  it('is true only once no part of the trigger is visible', () => {
    expect(isAnchorOutOfView(trigger(-30), VIEWPORT)).toBe(false);
    expect(isAnchorOutOfView(trigger(-50), VIEWPORT)).toBe(true);
    expect(isAnchorOutOfView(trigger(801), VIEWPORT)).toBe(true);
  });
});
