// Whether the household item has anything under More: the household's health plans to compare (more
// than one), or a policy to share or say who it covers. Neither was an empty list (gate A crawl, 11-15).
export function householdHasMore(
  healthPlans: number,
  policies: readonly { status: string }[],
): boolean {
  return healthPlans > 1 || policies.some((p) => p.status === "active");
}
