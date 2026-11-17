// A sideways row that scrolls (the area tabs on a phone): whether there is more of it before the
// part in view and after it, so those edges fade instead of cutting a label mid-word (founder,
// 11-16: the top navigation "cut mid-word at Lo…").
export function moreBeyond(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { before: boolean; after: boolean } {
  return {
    before: scrollLeft > 1,
    after: scrollLeft + clientWidth < scrollWidth - 1,
  };
}
