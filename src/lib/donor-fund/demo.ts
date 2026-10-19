import { DEMO_DONOR_FUND_NAME } from "@/config/giving";
import type { DonorFundPartner } from "./types";

// The donor-advised fund stand-in (spec step 168): "opens" a fund by name. It holds no
// money and sends nothing anywhere; it's only offered on demo-bank data.
export const demoDonorFund: DonorFundPartner = {
  name: "demo",
  async openFund() {
    return { fundName: DEMO_DONOR_FUND_NAME };
  },
};
