// What a payment partner does for an estimated tax payment: takes the amount for a due date
// and returns a confirmation. The stand-in is src/lib/tax-payments/demo.ts and moves no money;
// a real one (an IRS-authorized payment processor, IRS Direct Pay) plugs in behind this.
export interface TaxPaymentPartner {
  name: string;
  pay(input: { userId: string; dueOn: string; cents: number }): Promise<{ confirmation: string }>;
}
