import { isValidElement, type ReactNode } from "react";

// A server page, rendered far enough to see what it would send: each server component is called
// and awaited, and everything passed to a client component is kept, since that is what goes to
// the browser. A component that needs React's render (a client component's hooks) stays as it is:
// its props were already kept. Not a real renderer, and it doesn't need to be: nothing here is
// shown to anyone, only searched.

const MAX_DEPTH = 40;

export async function resolveTree(node: unknown, depth = 0): Promise<unknown> {
  if (depth > MAX_DEPTH) return null;
  const value = await node;
  if (Array.isArray(value)) {
    return Promise.all(value.map((child) => resolveTree(child, depth + 1)));
  }
  if (!isValidElement(value)) return value;
  const element = value as { type: unknown; props: Record<string, unknown> };
  const { children, ...props } = element.props as { children?: ReactNode };
  if (typeof element.type === "function") {
    let rendered: unknown;
    try {
      rendered = await (element.type as (p: unknown) => unknown)(element.props);
    } catch (error) {
      if (isControlFlow(error)) throw error;
      return { props: element.props };
    }
    return { props, rendered: await resolveTree(rendered, depth + 1) };
  }
  return { props, children: await resolveTree(children, depth + 1) };
}

// redirect() and notFound(): the page's own answer, not a failure to render.
function isControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}
