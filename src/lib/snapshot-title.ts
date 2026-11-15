// The card's title as the person agreed to it, from the decision's card snapshot.
export function snapshotTitle(snapshot: unknown): string {
  const title = (snapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" && title !== "" ? title : "Your request";
}
