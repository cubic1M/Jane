// A tap on the cash-flow strip that misses its small markers (17–28 px, a day about 11 px apart on
// a phone: mobile pass 11-16) opens the nearest one within reach, so each marker's tap area is the
// strip's height and half the way to its neighbours. Centres in the strip's own pixels.
export const MARK_REACH_PX = 48;

export function nearestMark(
  tap: { x: number; y: number },
  marks: readonly { x: number; y: number }[],
  reach = MARK_REACH_PX,
): number | null {
  let best: number | null = null;
  let bestDistance = reach;
  marks.forEach((m, i) => {
    const distance = Math.hypot(m.x - tap.x, m.y - tap.y);
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
