// A donor-advised fund through a partner (spec step 168). There's no partner yet, so the
// demo bank's people get a stand-in (./demo.ts) that opens a fund in name only. Swap in a
// real sponsor with an API (such as Daffy or a brokerage's charitable fund) behind
// DonorFundPartner. Money never moves through Jane: the person funds it themselves.

export interface DonorFundPartner {
  readonly name: string;
  openFund(input: { holder: string }): Promise<{ fundName: string }>;
}
