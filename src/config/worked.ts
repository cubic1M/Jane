// What worked (spec step 207): how long Jane waits for a saving to show in the person's
// transactions before saying it didn't, and what she learns from the results.

// A finished action whose saving hasn't shown after this many days is marked as not shown.
export const WORKED_GRACE_DAYS = 60;
// A kind of finding is down-ranked once it has this many answers and none worked or said yes.
export const WORKED_MIN_SAMPLE = 3;
// Spec step 147 reads step 207: a kind whose finished actions never showed a saving is asked
// about at most this many at a time (the rest wait for the next run).
export const WORKED_QUIET_PER_RUN = 1;
// How a down-ranked or proven kind moves the ranking's confidence.
export const WORKED_PROVEN_BOOST = true;
