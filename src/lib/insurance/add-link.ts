import type { PolicyKind } from "@/config/insurance";

// The insurance page's "Add a policy" form opens only when a link asks for it (?add=), so a person
// with no policies sees the tree first, not a long form (debugger 11-13). A link without a kind
// still asks, with "new", and the form starts on its usual kind.
export const addPolicyHref = (kind?: PolicyKind | null) => `/insurance?add=${kind ?? "new"}#add`;

export const addFormOpen = (add: string) => add !== "";
