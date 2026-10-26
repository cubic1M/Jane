import { expect, type Locator } from "@playwright/test";

// Every marching dotted line looks and moves the same (founder: "some are grey and some are
// white"): MARCHING_LINE in src/config/motion.ts, drawn by <MarchingPath>.
export async function expectMarchingLine(svg: Locator) {
  const path = svg.locator("path[data-marching-line]");
  await expect(path).toHaveCount(1);
  const style = await path.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      stroke: s.stroke,
      width: s.strokeWidth,
      dash: s.strokeDasharray,
      duration: s.animationDuration,
    };
  });
  expect(style).toEqual({
    stroke: "rgb(138, 138, 138)",
    width: "2px",
    dash: "3px, 6px",
    duration: "0.6s",
  });
}
