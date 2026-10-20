import { isPersonId, PEOPLE, type PersonId } from "@/config/people";

// Which sample person a visitor gets (spec step 252): the one they picked, one chosen for
// them on "any", or none (the original demo bank) when nothing was asked for.
export function pickPerson(
  asked: FormDataEntryValue | null | undefined,
  random: () => number = Math.random,
): PersonId | undefined {
  if (typeof asked !== "string") return undefined;
  if (isPersonId(asked)) return asked;
  if (asked === "any") return PEOPLE[Math.floor(random() * PEOPLE.length)].id;
  return undefined;
}
