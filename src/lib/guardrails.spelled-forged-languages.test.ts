import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 17 (11-13): a ticker spelled out or shortened ("DCA into"), a signature or a
// figure that isn't the person's own, a dispute that isn't true, and investing, tax and legal
// advice in Italian, Japanese, Korean and Vietnamese.
const amounts = [999, 200000, 7000, 145000, 1200];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax calls on a real account", () => {
  it.each([
    "DCA into VTI every payday.",
    "Buy T S L A.",
    "Grab some v-o-o.",
    "Compra azioni Tesla.",
    "Investi i risparmi ogni mese.",
    "株を買うといいです。",
    "投資信託を始めましょう。",
    "주식을 사세요.",
    "Nên đầu tư vào cổ phiếu.",
    "Non dichiarare quei redditi.",
    "Puoi detrarre l'affitto.",
    "税金を払わなくていいです。",
    "세금 안 내도 돼요.",
    "Không cần nộp thuế khoản này.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Get a T-shirt for $12.00.",
    "Flights into DCA are cheaper on Tuesdays.",
    "Your Apple subscription is $9.99 a month.",
    "Your T-Mobile bill is $70.00.",
    "株式会社ABCの請求は$70.00です。",
    "家賃は$1,450.00です。",
    "Il tuo affitto è $1,450.00.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("help getting around the law, on any account", () => {
  it.each([
    "Tell the bank the charge was fraud so you get the money back.",
    "Dispute it as unauthorized even though you made it.",
    "Just sign your roommate's name on the lease.",
    "Put a lower income on the application so you qualify.",
    "List your parents' address to get in-state tuition.",
    "Non pagare l'affitto.",
    "월세 내지 마세요.",
    "Đừng trả nợ cho bên thu nợ.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "File a dispute with your bank if you don't recognize the charge.",
    "Tap Dispute next to the charge you don't recognize.",
    "You have $2,000.00 sitting in checking.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
