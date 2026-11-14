import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

// Which banks' layouts Jane reads (simplify pass, 11-14: the bank words in BOILERPLATE grew one fix at
// a time, #1450, #1540, #1562, #1629, with nothing saying which banks were covered). One row per bank
// and kind of line: a card purchase at Netflix and a bill paid to Verizon Wireless, written as that
// bank writes them, and the merchant key Jane should get. A bank whose lines aren't here isn't known
// to be read right.

const NETFLIX = "netflix";
const VERIZON = "verizon wireless";
// The company's own entry description stays: it's on every month's line alike.
const VERIZON_PAYMENTS = "verizon wireless payments";

const LAYOUTS: [bank: string, line: string, key: string][] = [
  ["Chase, card", "NETFLIX.COM NETFLIX.COM CA", NETFLIX],
  ["Chase, ACH", "VERIZON WIRELESS PAYMENTS PPD ID: 1234567890", VERIZON_PAYMENTS],
  [
    "Chase, ACH long form",
    "ORIG CO NAME:VERIZON WIRELESS ORIG ID:1234567890 DESC DATE:260315 CO ENTRY DESCR:PAYMENTS SEC:WEB TRACE#:021000020000001 EED:260315 IND ID:XXXX1234 IND NAME:MAYA LEE TRN: 0742000001TC",
    VERIZON,
  ],
  [
    "Bank of America, card",
    "CHECKCARD 0818 NETFLIX.COM 866-579-7172 CA 24692168230100000000123",
    NETFLIX,
  ],
  [
    "Bank of America, ACH",
    "VERIZON WIRELESS DES:PAYMENTS ID:123456 INDN:LEE MAYA CO ID:XXXXX12345 WEB",
    VERIZON,
  ],
  [
    "Wells Fargo, card",
    "PURCHASE AUTHORIZED ON 03/15 NETFLIX.COM LOS GATOS CA S386074455 CARD 1234",
    NETFLIX,
  ],
  ["Wells Fargo, ACH", "VERIZON WIRELESS PAYMENTS 260315 1234567 LEE MAYA", VERIZON_PAYMENTS],
  ["Citi, card", "NETFLIX.COM          LOS GATOS     CA", NETFLIX],
  ["Capital One 360, card", "Debit Card Purchase - NETFLIX.COM", NETFLIX],
  ["Capital One 360, ACH", "Withdrawal to VERIZON WIRELESS", VERIZON],
  ["U.S. Bank, card", "DEBIT PURCHASE -VISA NETFLIX.COM 866-579-7172CA", NETFLIX],
  ["U.S. Bank, ACH", "WEB AUTHORIZED PMT VERIZON WIRELESS", VERIZON],
  ["PNC, card", "POS PURCHASE NETFLIX.COM 866-579-7172 CA", NETFLIX],
  ["PNC, ACH", "ACH WEB VERIZON WIRELESS PAYMENTS 1234567", VERIZON_PAYMENTS],
  ["TD, card", "DEBIT CARD PURCHASE, AUT 031526 VISA DDA PUR NETFLIX.COM 866 5797172 CA", NETFLIX],
  ["TD, ACH", "ELECTRONIC PMT-WEB, VERIZON WIRELESS PAYMENTS", VERIZON_PAYMENTS],
  ["Truist, card", "POS DEBIT NETFLIX.COM 866-579-7172 CA", NETFLIX],
  ["Truist, ACH", "ACH DEBIT VERIZON WIRELESS PAYMENTS", VERIZON_PAYMENTS],
  [
    "Navy Federal, card",
    "POS DEBIT- DEBIT CARD 1234 03-15-26 NETFLIX.COM 866-579-7172 CA",
    NETFLIX,
  ],
  ["Navy Federal, ACH", "PAID TO - VERIZON WIRELESS", VERIZON],
  ["KeyBank, card", "POS DEBIT NETFLIX.COM", NETFLIX],
  ["Huntington, card", "DEBIT CARD PURCHASE NETFLIX.COM 866-579-7172 CA", NETFLIX],
  ["Huntington, ACH", "ACH PAYMENT VERIZON WIRELESS", VERIZON],
  ["Fifth Third, ACH", "WEB PAYMENT VERIZON WIRELESS", VERIZON],
  ["Citizens, ACH", "ACH WITHDRAWAL VERIZON WIRELESS", VERIZON],
  ["A bank that puts ACH DEBIT last", "VERIZON WIRELESS PAYMENTS ACH DEBIT", VERIZON_PAYMENTS],
  ["USAA, card", "NETFLIX.COM 866-579-7172 CA 03/15", NETFLIX],
  ["Ally, ACH", "VERIZON WIRELESS PAYMENTS", VERIZON_PAYMENTS],
  ["Discover, card", "NETFLIX.COM 866-579-7172 CA", NETFLIX],
  ["American Express, card", "NETFLIX.COM LOS GATOS CA", NETFLIX],
  ["Chime, card", "Netflix.com", NETFLIX],
  ["SoFi, card", "NETFLIX.COM", NETFLIX],
];

describe("each bank's layout", () => {
  it.each(LAYOUTS)("%s: %s", (_bank, line, key) => {
    expect(normalizeMerchant(line)?.key).toBe(key);
  });
});
