import { TRIAL_ID_PREFIX } from "@/config/trial";

// The jobs that run over everyone (the crons) take `userIds` to keep a run to those people: a
// test's own, never everyone's in the shared test database, where a run for all reached people
// other test files were using mid-test (#812, #818). Left out, the run is for everyone.
export type OnlyPeople = { userIds?: readonly string[] };

// A where for rows those people own.
export const ownedBy = (userIds?: readonly string[]) =>
  userIds ? { userId: { in: [...userIds] } } : {};

// A where for those people themselves.
export const peopleIn = (userIds?: readonly string[]) =>
  userIds ? { id: { in: [...userIds] } } : {};

// Left out, a nightly run is for everyone who stays. A temporary person is gone within a day or
// two and is worked out when they arrive, and 500 of them cost the night's loops 68 seconds on a
// local database, out of a limit of 300 with the banks and the controller still to come. Their
// ids sort last, but the steps after those loops come last too.
export const STAYING = { not: { startsWith: TRIAL_ID_PREFIX } };

export const ownedByStaying = (userIds?: readonly string[]) =>
  userIds ? ownedBy(userIds) : { userId: STAYING };

export const stayingPeople = (userIds?: readonly string[]) =>
  userIds ? peopleIn(userIds) : { id: STAYING };
