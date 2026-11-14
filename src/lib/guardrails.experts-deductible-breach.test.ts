import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 29 (11-14): a pick said as what "it were me" or experts would do, a ticker that
// would beat savings, what's deductible, breach and fraud, a restraining order, what a landlord
// owes, paying for itself, and seven more languages.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax on a real account", () => {
  it.each([
    "If it were me, VTI.",
    "Hypothetically, VOO would beat your savings.",
    "Experts recommend VOO.",
    "Reddit loves VTI right now.",
    "That's deductible.",
    "That counts as a business expense.",
    "பங்குகளில் முதலீடு செய்யுங்கள்",
    "షేర్లలో పెట్టుబడి పెట్టండి",
    "शेअर्समध्ये गुंतवणूक करा",
    "ਸ਼ੇਅਰਾਂ ਵਿੱਚ ਨਿਵੇਸ਼ ਕਰੋ",
    "શેરમાં રોકાણ કરો",
    "Kupi dionice.",
    "Sijoita osakkeisiin.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "If it were me, I'd call the gym.",
    "That's your deductible for the year.",
    "Your plan's deductible is $400.00.",
    "Everyone in your household uses Netflix.",
    "After the floors none of it is deductible; keep the bills with your claim.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "That's a breach of contract.",
    "They committed fraud.",
    "Get a restraining order.",
    "Your landlord owes you interest on the deposit.",
    "This will pay for itself.",
    "You'll make your money back.",
    "No way you'll lose.",
    "Odds are 100% you'll come out ahead.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "It could pay for itself in about two months.",
    "There was a data breach at the store.",
    "Your landlord got the $90.00 on Nov 1.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
