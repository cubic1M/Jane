import { SideIncomeError, saveSideIncomeAnswers, loadSideIncome } from "@/lib/side-income";
import { ChatActionError, type ActionHandler } from "./handler";

// Hobby or business from the chat (spec step 173): the person's own answer, which changes
// how their side income is taxed in the estimate. Rental details are on the profile page.

const choose = (
  id: "tax.side_business" | "tax.side_hobby",
  kind: "business" | "hobby",
): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      // Keep the rental details already given.
      const view = await loadSideIncome(userId, { client, now });
      await saveSideIncomeAnswers(
        userId,
        {
          rental:
            view.rental?.priceCents && view.rental.placedOn
              ? { priceCents: view.rental.priceCents, placedOn: view.rental.placedOn }
              : null,
          kind,
        },
        { client, now, via: "chat" },
      );
    } catch (error) {
      if (error instanceof SideIncomeError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note:
        kind === "hobby"
          ? "Got it: a hobby. Its income is taxed with no expenses and no self-employment tax."
          : "Got it: a business. Its profit bears self-employment tax, and its expenses come off.",
    };
  },
});

export const taxSideBusiness = choose("tax.side_business", "business");
export const taxSideHobby = choose("tax.side_hobby", "hobby");
