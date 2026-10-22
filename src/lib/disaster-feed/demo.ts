import { SAMPLE_RELIEF } from "@/config/disasters";
import type { DisasterFeed } from "./types";

// The stand-in feed (spec step 270): the sample declarations in src/config/disasters.ts. Swap in
// a feed that reads the IRS disaster relief page and FEMA's OpenFEMA declarations.
export const demoDisasterFeed: DisasterFeed = {
  name: "Sample disaster relief (stand-in)",
  async declarations() {
    return SAMPLE_RELIEF;
  },
};
