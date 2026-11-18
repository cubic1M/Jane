import { randomInt } from "node:crypto";
import { isPersonId, PEOPLE, type PersonId } from "@/config/people";

// Which sample person a visitor gets (spec step 252): the one they picked, one chosen for
// them on "any", or none (the original demo bank) when nothing was asked for. Chosen with
// node:crypto (code scanning, js/insecure-randomness); a test can hand in its own random.
export function pickPerson(
  asked: FormDataEntryValue | null | undefined,
  random?: () => number,
): PersonId | undefined {
  if (typeof asked !== "string") return undefined;
  if (isPersonId(asked)) return asked;
  if (asked === "any") {
    const index = random ? Math.floor(random() * PEOPLE.length) : randomInt(PEOPLE.length);
    return PEOPLE[index].id;
  }
  return undefined;
}
