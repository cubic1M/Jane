import type { Relief } from "@/config/disasters";

// Where disaster relief declarations come from (spec step 270): every postponement the IRS
// (and states that follow it) has announced, by state and county. Read only.
export type DisasterFeed = {
  name: string;
  declarations(): Promise<readonly Relief[]>;
};
