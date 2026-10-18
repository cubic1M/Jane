import type { PfcDetailed } from "@/categorize/taxonomy";

// The merchant directory's starting rows: common subscriptions. Shared knowledge about
// companies, never about people. Links are each company's own account or help pages;
// every row starts unreviewed, so the team checks it at /admin/merchants before relying
// on it. Prices change too often to seed; the team adds typical prices when reviewing.

export type MerchantSeed = {
  // The normalized merchant key (src/data-sources/merchant.ts), lower case.
  key: string;
  name: string;
  // Other normalized keys the same company shows up as on statements. One-word keys and
  // aliases match only exactly ("apple", not "apple store"); longer ones also match with
  // more words after them ("spotify usa" matches "spotify usa stockholm").
  aliases: string[];
  category: PfcDetailed | null;
  cancelUrl: string | null;
  supportUrl: string | null;
};

export const MERCHANT_SEED: readonly MerchantSeed[] = [
  {
    key: "netflix",
    name: "Netflix",
    aliases: ["nflx", "netflix inc"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: "https://www.netflix.com/cancelplan",
    supportUrl: "https://help.netflix.com",
  },
  {
    key: "hulu",
    name: "Hulu",
    aliases: ["hulu llc", "hulu com"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: "https://secure.hulu.com/account",
    supportUrl: "https://help.hulu.com",
  },
  {
    key: "disney plus",
    name: "Disney+",
    aliases: ["disneyplus"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: "https://www.disneyplus.com/account",
    supportUrl: "https://help.disneyplus.com",
  },
  {
    key: "max",
    name: "Max",
    aliases: ["hbo max", "hbomax"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: null,
    supportUrl: "https://help.max.com",
  },
  {
    key: "peacock",
    name: "Peacock",
    aliases: ["peacocktv", "peacock tv"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: "https://www.peacocktv.com/account",
    supportUrl: null,
  },
  {
    key: "paramount plus",
    name: "Paramount+",
    aliases: ["paramountplus"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: "https://www.paramountplus.com/account/",
    supportUrl: null,
  },
  {
    key: "youtube premium",
    name: "YouTube Premium",
    aliases: ["youtubepremium", "google youtube premium", "youtube tv"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cancelUrl: "https://www.youtube.com/paid_memberships",
    supportUrl: null,
  },
  {
    key: "spotify",
    name: "Spotify",
    aliases: ["spotify usa", "spotify ab"],
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    cancelUrl: "https://www.spotify.com/account/subscription/",
    supportUrl: "https://support.spotify.com",
  },
  {
    key: "siriusxm",
    name: "SiriusXM",
    aliases: ["sirius xm", "sirius radio"],
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    cancelUrl: null,
    supportUrl: "https://care.siriusxm.com",
  },
  {
    key: "audible",
    name: "Audible",
    aliases: ["audible inc", "audible us"],
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    cancelUrl: null,
    supportUrl: "https://help.audible.com",
  },
  {
    key: "apple",
    name: "Apple",
    aliases: ["apple com bill", "itunes", "itunes com"],
    category: null,
    cancelUrl: "https://apps.apple.com/account/subscriptions",
    supportUrl: "https://support.apple.com",
  },
  {
    key: "google play",
    name: "Google Play",
    aliases: ["google play store"],
    category: null,
    cancelUrl: "https://play.google.com/store/account/subscriptions",
    supportUrl: null,
  },
  {
    key: "amazon prime",
    name: "Amazon Prime",
    aliases: ["amzn prime", "prime video", "amazon prime video"],
    category: null,
    cancelUrl: "https://www.amazon.com/mc",
    supportUrl: null,
  },
  {
    key: "dropbox",
    name: "Dropbox",
    aliases: ["dropbox inc"],
    category: null,
    cancelUrl: "https://www.dropbox.com/account/plan",
    supportUrl: "https://help.dropbox.com",
  },
  {
    key: "adobe",
    name: "Adobe",
    aliases: ["adobe inc", "adobe systems"],
    category: null,
    cancelUrl: "https://account.adobe.com/plans",
    supportUrl: "https://helpx.adobe.com",
  },
  {
    key: "microsoft",
    name: "Microsoft 365",
    aliases: ["msft"],
    category: null,
    cancelUrl: "https://account.microsoft.com/services",
    supportUrl: "https://support.microsoft.com",
  },
  {
    key: "new york times",
    name: "The New York Times",
    aliases: ["nytimes", "ny times", "nyt"],
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    cancelUrl: "https://myaccount.nytimes.com",
    supportUrl: "https://help.nytimes.com",
  },
  {
    key: "peloton",
    name: "Peloton",
    aliases: ["onepeloton", "peloton interactive"],
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    cancelUrl: null,
    supportUrl: "https://support.onepeloton.com",
  },
  {
    key: "planet fitness",
    name: "Planet Fitness",
    aliases: ["planetfitness", "pf club fees"],
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    cancelUrl: null,
    supportUrl: "https://www.planetfitness.com",
  },
  {
    key: "openai",
    name: "ChatGPT",
    aliases: ["chatgpt", "openai chatgpt", "openai chatgpt subscr"],
    category: null,
    cancelUrl: null,
    supportUrl: "https://help.openai.com",
  },
  {
    key: "duolingo",
    name: "Duolingo",
    aliases: ["duolingo inc"],
    category: null,
    cancelUrl: null,
    supportUrl: "https://support.duolingo.com",
  },
];
