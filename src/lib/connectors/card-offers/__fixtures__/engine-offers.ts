// Engine-shaped card offers (field names from round 15's mock notes), all made up: the card names,
// issuers, rates and links are fake. One uses each spelling Engine has been seen to use.

export const BT_CARD = {
  uuid: "offer-fake-bt",
  partner: { name: "Example Bank", disclaimer: "Example Bank is an issuer." },
  details: {
    cardName: "Example Transfer Card",
    ratesUrl: "https://cards.example-bank.test/rates",
    minPurchaseApr: 19.24,
    maxPurchaseApr: "28.24",
    aprType: "variable",
    minPurchaseIntroApr: 0,
    purchaseIntroAprTerm: 15,
    purchaseIntroAprTermUnit: "months",
    minBalanceTransferIntroApr: "0",
    balanceTransferIntroAprTerm: 18,
    balanceTransferIntroAprTermUnit: "billing cycles",
    // A bare percent, and the minimum only in the disclaimer.
    balanceTransferFee: 3,
    balanceTransferFeeDisclaimer: "Either 3% or $5, whichever is greater.",
    minAnnualFee: 0,
    maxAnnualFee: 0,
    recommendedCreditRatingsDisclaimer: "Recommended for good to excellent credit.",
    preApproved: false,
  },
};

export const REWARDS_CARD = {
  uuid: "offer-fake-rewards",
  partner: { name: "Sample Card Co" },
  details: {
    cardName: "Sample Rewards Card",
    ratesUrl: "https://sample-card.test/terms",
    minPurchaseApr: "21.99%",
    aprType: "Variable",
    maxAnnualFee: "95",
    // The other spelling.
    recommendedCreditRatingDisclaimer: "Excellent credit recommended.",
  },
};
