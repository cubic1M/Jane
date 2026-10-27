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
