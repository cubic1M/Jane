import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "./rate-limits";
import { STATEMENT_TRIAL_ROWS_A_DAY } from "./statement-trial";

// Anyone can make these people, and each limit looks fine alone. Measured on a local build,
// indexes included: a sample person about 850 KB, a statement's 1,000 rows about 0.7 MB. They stay
// about a day under steady use, since each start deletes those past their time. Neon's free plan
// holds about 500 MB, and real people's data has to fit too.
const SAMPLE_PERSON_MB = 0.85;
const STATEMENT_THOUSAND_ROWS_MB = 0.7;
const MOST_A_DAY_MB = 200;

describe("what anonymous people can keep in the database in a day", () => {
  it("fits, with both ceilings reached at once", () => {
    const samples = RATE_LIMITS.trialEveryoneDay.limit * SAMPLE_PERSON_MB;
    const statements = (STATEMENT_TRIAL_ROWS_A_DAY / 1_000) * STATEMENT_THOUSAND_ROWS_MB;
    expect(samples + statements).toBeLessThanOrEqual(MOST_A_DAY_MB);
  });
});
