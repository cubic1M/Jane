// A paper check: the bank's line is the check's number and nothing else ("CHECK # 1208",
// "Check Paid #1042", "CHK 1042"), so who it paid is unknown and one price every month isn't a
// plan (debugger 11-01: "Review your Check subscription", $960 a year). "CHECK CARD …" is a card.
export const PAPER_CHECK = /^(?:CHECK|CHK)(?: PAID| NO\.?)?\s*#?\s*\d+$/i;
