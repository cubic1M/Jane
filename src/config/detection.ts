// Every threshold, rate and multiplier the detection rules use. Tune these during the
// beta; rule code must read them from here, never inline its own numbers.
//
// Category names are Plaid PFCv2 (see src/categorize/taxonomy.ts), checked against
// https://plaid.com/documents/pfc-taxonomy-all.csv on 2026-10-17.
//
// Split by area so two lanes tuning different rules don't touch one file: add to the file for
// your area, and import from "@/config/detection" as before.

export * from "./detection/general";
export * from "./detection/recurring";
export * from "./detection/subscriptions";
export * from "./detection/price-increase";
export * from "./detection/fees";
export * from "./detection/cover";
export * from "./detection/idle-cash";
export * from "./detection/forecast";
export * from "./detection/paydays";
export * from "./detection/refunds";
export * from "./detection/watching";
export * from "./detection/bill-negotiation";
export * from "./detection/alerts";
export * from "./detection/unusual";
export * from "./detection/rent-to-a-person";
