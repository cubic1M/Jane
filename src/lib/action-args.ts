// A server action receives whatever the browser sends, whatever its TypeScript says. An id that
// isn't a string can widen a Prisma filter ({ not: "" } matches every row of the person's) or fail
// with an error repeating what was sent.
export const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
