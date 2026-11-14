import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 31 (11-14): where the market goes, two tickers that "either" work, a dated
// fund, mileage as deductible, reporting money as a gift, skipping court, not paying a debt, a
// judge siding with you, a dispute or refund promised, and twenty more languages.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax on a real account", () => {
  it.each([
    "The market will go up.",
    "VOO or VTI, either works.",
    "Pick a 2060 fund.",
    "Mileage is deductible.",
    "Report it as a gift.",
    "ഓഹരികളിൽ നിക്ഷേപിക്കുക",
    "ಷೇರುಗಳಲ್ಲಿ ಹೂಡಿಕೆ ಮಾಡಿ",
    "ଶେୟାରରେ ନିବେଶ କରନ୍ତୁ",
    "කොටස්වල ආයෝජනය කරන්න",
    "ရှယ်ယာများတွင် ရင်းနှီးမြှုပ်နှံပါ",
    "វិនិយោគលើភាគហ៊ុន",
    "ລົງທຶນໃນຫຸ້ນ",
    "ჩადეთ ინვესტიცია აქციებში",
    "Ներդրեք բաժնետոմսերում",
    "Акцияларға инвестиция салыңыз",
    "Хувьцаанд хөрөнгө оруулаарай",
    "በአክሲዮን ኢንቨስት ያድርጉ",
    "Zuba jari a hannun jari.",
    "Tshala imali kumasheya.",
    "Maalgeli saamiyada.",
    "Buddsoddwch mewn cyfranddaliadau.",
    "Infheistigh i scaireanna.",
    "Inbertitu akzioetan.",
    "Inviste en accións.",
    "Інвесціруйце ў акцыі.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Your rent went up in October.",
    "Groceries are on sale at Costco this week.",
    "Your HSA balance is $90.00.",
    "Commuting isn't something I can see in your accounts.",
    "Report it as fraud to your bank.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "Don't show up to court.",
    "You don't have to pay that debt.",
    "The judge will side with you.",
    "They're violating your rights.",
    "Your dispute will win.",
    "The charge will be reversed.",
    "They will refund you.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "The charge was reversed on Nov 3.",
    "The dispute is still open.",
    "Your refund of $90.00 landed Nov 2.",
    "You have a court fee of $90.00 on Nov 2.",
    "Netflix's price will go up Dec 1, per their email.",
    "You don't have to pay the card in full; the minimum is $90.00.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });

  it("lets demo name the sample plan's dated fund", () => {
    expect(demo("All of it is in the Northstar Target 2055 Fund.").ok).toBe(true);
  });
});
