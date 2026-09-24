export type ScrollAxis = 'scrollLeft' | 'scrollTop';

// Positions set by `follow`, per element and axis. The scroll event that follows is an echo of our own change,
// not the user scrolling, and must not be synced back: by then the source may have moved on (momentum
// scrolling), and syncing the stale position back would pull it back a step on every frame, visible as flicker.
const expected = new WeakMap<HTMLElement, Record<ScrollAxis, number | null>>();

/** Makes `targets` follow `from` on one axis. Differences under a pixel are rounding, not scrolling. */
export function follow(from: HTMLElement | null, axis: ScrollAxis, ...targets: (HTMLElement | null)[]): void {
  if (!from) return;
  for (const target of targets) {
    if (!target || Math.abs(from[axis] - target[axis]) < 1) continue;
    target[axis] = from[axis];
    // Read back: the browser may round or clamp.
    expected.set(target, {
      scrollLeft: null,
      scrollTop: null,
      ...expected.get(target),
      [axis]: target[axis],
    });
  }
}

/** Whether the current scroll event on `element` is the echo of a `follow`. Each expectation is used once. */
export function isEcho(element: HTMLElement | null, axis: ScrollAxis): boolean {
  const entry = element ? expected.get(element) : undefined;
  const position = entry?.[axis] ?? null;
  if (!element || !entry || position === null) return false;
  entry[axis] = null;
  return Math.abs(element[axis] - position) < 1;
}
