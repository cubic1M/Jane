// How to cancel the most common US subscriptions and bills (the cancel connector,
// src/lib/connectors/cancel/route.ts). From the connectors-roadmap research, round 7 (2026-11-06):
// the merchants' own help and terms pages, public pages only, nothing signed up for or contacted;
// each row keeps its sources. Re-check a row against its sources before relying on it for a real
// person: merchants change these pages.
//
// - channel: what the research picked first. "guided" is the steps for the person; "email" only
//   where the merchant documents cancelling by email (2 of 56); "letter" where written notice is
//   the documented way; "phone" where only a call or a visit works. Jane makes no calls, so a
//   phone row is shown as guided steps.
// - email: set only where the merchant's own page accepts a cancellation by email.
// - steps: as the research wrote them, the merchant's own words where it had them.

export type CancelChannel =
  "guided" | "email" | "letter" | "phone" | "stop_payment_letter" | "card_lock";

export type CancelMethod = {
  merchant: string;
  // Lower-case names a merchant's charges or Jane's merchant name contain.
  aliases: readonly string[];
  channel: CancelChannel;
  fallback: CancelChannel;
  steps: readonly string[];
  email: string | null;
  // The merchant says it takes cancellation email from an assistant on someone's behalf (round 19's
  // email_send_gate). Unset everywhere: none has said so.
  acceptsAgentEmail?: boolean;
  sources: readonly string[];
};

// A charge billed through an app store can only be cancelled there (32 of the 56 can be). The
// descriptor says so: it contains one of these, in any case.
export const APP_STORE_DESCRIPTORS = {
  apple: ["APPLE.COM/BILL", "ITUNES.COM"],
  google: ["GOOGLE *", "GOOGLE PLAY"],
} as const;

// Google charges that aren't Google Play (security review on #1506): Workspace, Cloud, Ads, Domains
// and Fiber are billed by Google itself and cancelled in their own consoles, not in Play.
export const NOT_GOOGLE_PLAY = ["GSUITE", "WORKSPACE", "CLOUD", "ADS", "DOMAINS", "FIBER"] as const;

export const CANCEL_METHODS: readonly CancelMethod[] = [
  {
    merchant: "Netflix",
    aliases: ["netflix"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: netflix.com Account > Manage membership > Cancel > Finish Cancellation"],
    email: null,
    sources: ["https://help.netflix.com/en/node/407"],
  },
  {
    merchant: "Spotify",
    aliases: ["spotify"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "online: spotify.com/account/subscription/manage > Cancel subscription",
      "form: spotify.com/account/cancel/pdf/ (cancellation form)",
    ],
    email: null,
    sources: ["https://support.spotify.com/us/article/cancel-premium/"],
  },
  {
    merchant: "Hulu",
    aliases: ["hulu"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: hulu.com/account > Cancel"],
    email: null,
    sources: [
      "https://help.hulu.com/article/hulu-manage-subscription",
      "https://www.hulu.com/subscriber_agreement",
    ],
  },
  {
    merchant: "Disney+",
    aliases: ["disney+"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: disneyplus.com/account/cancel-subscription > Cancel Subscription",
      "in-app: Account > Subscription",
    ],
    email: null,
    sources: [
      "https://help.disneyplus.com/article/disneyplus-en-us-cancel",
      "https://help.disneyplus.com/en-GB/article/disneyplus-third-party-subscription",
      "https://www.hulu.com/subscriber_agreement",
    ],
  },
  {
    merchant: "HBO Max (Max)",
    aliases: ["hbo max", "max.com"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: hbomax.com/subscription > Cancel Your Subscription",
      "in-app: profile > Subscription",
      "TV app: Settings > Subscription",
    ],
    email: null,
    sources: ["https://help.hbomax.com/cancel", "https://help.hbomax.com/refund"],
  },
  {
    merchant: "Peacock",
    aliases: ["peacock"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: peacocktv.com/account/plans > Cancel All Subscriptions",
      "chat: via help page if you can't log in",
    ],
    email: null,
    sources: [
      "https://www.peacocktv.com/help/article/cancellation",
      "https://www.peacocktv.com/terms",
    ],
  },
  {
    merchant: "Paramount+",
    aliases: ["paramount+"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: paramountplus.com/account > Cancel Subscription",
      "Google Play: g.co/play/subscriptions",
    ],
    email: null,
    sources: [
      "https://support.paramountplus.com/s/article/PI-How-do-I-cancel-my-subscription?language=en_US",
    ],
  },
  {
    merchant: "YouTube Premium",
    aliases: ["youtube premium", "youtube"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: youtube.com/paid_memberships > Manage membership > Deactivate",
      "in-app (Android): profile > Purchases and memberships > Cancel",
    ],
    email: null,
    sources: ["https://support.google.com/youtube/answer/6308278"],
  },
  {
    merchant: "Apple One / iCloud+ (Apple subscriptions)",
    aliases: ["apple one", "icloud"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "web: account.apple.com > Subscriptions",
      "iPhone/iPad: Settings > [name] > Subscriptions > Cancel",
      "Mac: App Store > [name] > Subscriptions",
      "iCloud+ without a device: reportaproblem.apple.com",
      "Windows: Apple Music/TV app > Account > Manage Subscriptions",
    ],
    email: null,
    sources: [
      "https://support.apple.com/en-us/118428",
      "https://support.apple.com/en-us/108318",
      "https://support.apple.com/en-us/121290",
      "https://support.apple.com/en-us/118223",
    ],
  },
  {
    merchant: "Amazon Prime",
    aliases: ["amazon prime", "amzn prime"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: Prime Central > End Membership (Cancel Your Prime Membership page)",
      "online: Your Memberships and Subscriptions > Manage Subscription > Cancel",
    ],
    email: null,
    sources: [
      "https://www.amazon.com/gp/help/customer/display.html?nodeId=GTJQ7QZY7QL2HK4Y",
      "https://www.amazon.com/gp/help/customer/display.html?nodeId=G2B9L3YR7LR8J4XP",
      "https://www.amazon.com/gp/help/customer/display.html?nodeId=GU8AWX4GDKM7QGTE",
    ],
  },
  {
    merchant: "Audible",
    aliases: ["audible"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "online: audible.com Account > Membership details > Cancel membership",
      "chat: audible.com/contactus",
      "phone: offered on help page (number not found on official pages fetched)",
    ],
    email: null,
    sources: [
      "https://help.audible.com/s/article/cancel-membership?language=en_US",
      "https://help.audible.com/s/article/manage-app-store-subscription?language=en_US",
      "https://www.audible.com/contactus",
    ],
  },
  {
    merchant: "Kindle Unlimited",
    aliases: ["kindle unlimited"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: Kindle Unlimited Central / Memberships & Subscriptions > Cancel membership"],
    email: null,
    sources: [
      "https://www.amazon.com/gp/help/customer/display.html?nodeId=T14kmeziBQrl6FYUjz",
      "https://www.amazon.com/gp/help/customer/display.html?nodeId=201556940",
    ],
  },
  {
    merchant: "Adobe Creative Cloud",
    aliases: ["adobe"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: account.adobe.com > Plans and payment > Manage plan > Cancel plan",
      "chat: helpx.adobe.com/contact.html",
    ],
    email: null,
    sources: [
      "https://helpx.adobe.com/account/individual/subscriptions-and-plans/renewals-and-cancellations/cancel-adobe-subscription.html",
      "https://helpx.adobe.com/account/individual/terms-policies-and-regulations/adobe-subscription-terms.html",
      "https://helpx.adobe.com/x-productkb/policy-pricing/adobe-settlement-benefit-faq.html",
    ],
  },
  {
    merchant: "Microsoft 365",
    aliases: ["microsoft 365", "msft"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: account.microsoft.com/services > Manage > Cancel subscription"],
    email: null,
    sources: [
      "https://support.microsoft.com/en-us/accounts-billing/subscriptions/cancel-a-microsoft-365-subscription",
      "https://support.microsoft.com/en-us/accounts-billing/subscriptions/microsoft-subscription-refund-policy",
      "https://support.microsoft.com/en-us/accounts-billing/subscriptions/manage-your-microsoft-365-subscription-purchased-through-a-third-party",
    ],
  },
  {
    merchant: "Google One",
    aliases: ["google one"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: one.google.com > Settings > Cancel membership",
      "in-app (Android): Menu > Settings > Cancel membership",
      "in-app (iOS): Membership plans > Manage plan > Cancel",
    ],
    email: null,
    sources: [
      "https://support.google.com/googleone/answer/9056360?hl=en&co=GENIE.Platform%3DDesktop",
      "https://support.google.com/googleone/answer/6374282?hl=en&co=GENIE.Platform%3DDesktop",
    ],
  },
  {
    merchant: "Dropbox",
    aliases: ["dropbox"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "online: dropbox.com > avatar > Manage account > Cancel plan",
      "mail: Dropbox, Inc., P.O. Box 77767, San Francisco, CA 94107 (US/Canada/Mexico; template letter on help page)",
    ],
    email: null,
    sources: [
      "https://help.dropbox.com/plans/downgrade-dropbox-individual-plans",
      "https://help.dropbox.com/plans/cancel-mobile",
    ],
  },
  {
    merchant: "ChatGPT Plus (OpenAI)",
    aliases: ["chatgpt", "openai"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: chatgpt.com > Settings > Billing (or Account) > Cancel plan",
      "iOS: Settings > [name] > Subscriptions > ChatGPT",
      "Android: Play Store > Subscriptions > ChatGPT",
      "support: help.openai.com chat cancels direct-billed plans if account email is lost",
    ],
    email: null,
    sources: [
      "https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription",
      "https://help.openai.com/en/articles/7232895-how-do-i-request-a-refund-for-my-chatgpt-subscription",
      "https://help.openai.com/en/articles/20001056-troubleshooting-chatgpt-subscription-access-and-account-changes",
    ],
  },
  {
    merchant: "Claude Pro (Anthropic)",
    aliases: ["claude.ai", "anthropic"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: claude.ai > name > Settings > Billing > Cancel",
      "in-app (iOS/Android): initials > Billing > Manage subscription",
      "support messenger: Get help > Send us a message (can cancel and refund if eligible)",
    ],
    email: null,
    sources: [
      "https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription",
      "https://support.claude.com/en/articles/12386328-request-a-refund-for-a-paid-claude-plan",
    ],
  },
  {
    merchant: "Duolingo (Super/Max)",
    aliases: ["duolingo"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: duolingo.com > Settings > Super Duolingo > Cancel subscription",
      "in-app: Settings > Manage subscription (hands off to App Store / Play)",
    ],
    email: null,
    sources: [
      "https://www.duolingo.com/help/cancel-my-super-duolingo-subscription",
      "https://www.duolingo.com/help/how-do-I-request-a-refund",
    ],
  },
  {
    merchant: "Grammarly",
    aliases: ["grammarly"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: account.grammarly.com > Subscription > Cancel Subscription"],
    email: null,
    sources: [
      "https://support.grammarly.com/hc/en-us/articles/115000090172-How-do-I-cancel-my-subscription",
      "https://support.grammarly.com/hc/en-us/articles/360049189071-Can-I-get-a-refund",
    ],
  },
  {
    merchant: "Canva Pro",
    aliases: ["canva"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: canva.com > Settings > Billing > Cancel plan", "pause (annual plans)"],
    email: null,
    sources: [
      "https://www.canva.com/help/cancel-canva-plan/",
      "https://www.canva.com/help/subscription-refunds/",
    ],
  },
  {
    merchant: "Notion",
    aliases: ["notion"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: Settings > Billing > Change plan > Free", "support: in-app contact support"],
    email: null,
    sources: [
      "https://www.notion.com/help/upgrade-or-downgrade-your-plan",
      "https://www.notion.com/help/refunds",
    ],
  },
  {
    merchant: "Planet Fitness",
    aliases: ["planet fitness"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "online: planetfitness.com member portal (log in)",
      "in-person: home club",
      "mail: written notice to home club",
    ],
    email: null,
    sources: [
      "https://www.planetfitness.com/about-planet-fitness/customer-service",
      "https://www.planetfitness.com/text",
    ],
  },
  {
    merchant: "Equinox",
    aliases: ["equinox"],
    channel: "email",
    fallback: "letter",
    steps: [
      "email: Cancellations@Equinox.com",
      "online: equinox.com (log in)",
      "in-person: club manager",
      "mail: per Membership Agreement",
    ],
    email: "Cancellations@Equinox.com",
    sources: ["https://www.equinox.com/faq", "https://www.equinox.com/member-policies"],
  },
  {
    merchant: "LA Fitness",
    aliases: ["la fitness"],
    channel: "letter",
    fallback: "guided",
    steps: [
      "mail: written notice to LA Fitness, P.O. Box 54170, Irvine, CA 92619 (registered/certified recommended)",
      "online: cancel online link on contact page",
      "in-person: club front desk",
      "email: in some states",
    ],
    email: null,
    sources: [
      "https://www.lafitness.com/pages/membershipquestions.aspx",
      "https://www.lafitness.com/pages/contactus.aspx",
    ],
  },
  {
    merchant: "Crunch Fitness",
    aliases: ["crunch"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "online: Member Portal > Manage Membership (some clubs only)",
      "phone: home club (number on location page)",
      "in-person: home club",
    ],
    email: null,
    sources: ["https://www.crunch.com/faq", "https://www.crunch.com/terms-of-use"],
  },
  {
    merchant: "ClassPass",
    aliases: ["classpass"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: classpass.com > Account > Settings > Cancel your membership",
      "in-app: Profile > Settings > Billing > Cancel my membership",
    ],
    email: null,
    sources: [
      "https://help.classpass.com/hc/en-us/articles/204578119-How-do-I-cancel-my-ClassPass-membership",
      "https://help.classpass.com/hc/en-us/articles/205433975-What-is-the-ClassPass-refund-policy",
    ],
  },
  {
    merchant: "Peloton (All-Access / App)",
    aliases: ["peloton"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online (All-Access): membership page > Manage > Pause or cancel",
      "online (App): members.onepeloton.com/preferences/subscriptions > Cancel",
      "store: Apple / Google Play / Roku subscriptions",
    ],
    email: null,
    sources: [
      "https://support.onepeloton.com/hc/en-us/articles/205541225-Managing-Your-All-Access-Membership",
      "https://support.onepeloton.com/hc/en-gb/articles/205411915-How-To-Cancel-A-Peloton-app-Membership",
    ],
  },
  {
    merchant: "DoorDash DashPass",
    aliases: ["dashpass", "doordash"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "in-app / doordash.com: account > Manage DashPass > Cancel Membership",
      "chat: in-app support 24/7",
      "phone: 855-431-0459 (support, on help page)",
    ],
    email: null,
    sources: [
      "https://help.doordash.com/en-us/consumers/article/how-do-i-cancel-my-dashpass-subscription",
      "https://help.doordash.com/en-us/consumers/article/amazon-dashpass-partnership",
    ],
  },
  {
    merchant: "Uber One",
    aliases: ["uber one"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "in-app: Account > Uber One > Manage Membership > End Membership",
      "online: ubereats.com > Uber One > Manage Membership > End Membership",
      "support form in help center",
    ],
    email: null,
    sources: [
      "https://help.uber.com/en/riders/article/how-do-i-cancel-my-uber-one-membership?nodeId=2748c138-d8b9-49a7-b6ee-3e2bb07bae28",
      "https://help.uber.com/en/ubereats/restaurants/article/uber-one-cancellation-and-refund?nodeId=2c21ad9e-2795-4b62-b3f8-95155ce9dd27",
    ],
  },
  {
    merchant: "Instacart+",
    aliases: ["instacart"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online / in-app: Account > Your Instacart+ membership > Cancel membership > Confirm"],
    email: null,
    sources: [
      "https://www.instacart.com/help/section/107169420/423178048",
      "https://www.instacart.com/terms",
    ],
  },
  {
    merchant: "HelloFresh",
    aliases: ["hellofresh"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: Account Settings > Plan settings > Status > Cancel Plan",
      "chat / phone: Customer Care via contact page (number not found on official page)",
    ],
    email: null,
    sources: [
      "https://www.hellofresh.com/about/how-to-cancel-hellofresh-subscription",
      "https://support.hellofresh.com/hc/en-us/articles/115008544627-How-do-I-cancel-",
    ],
  },
  {
    merchant: "Blue Apron",
    aliases: ["blue apron"],
    channel: "email",
    fallback: "guided",
    steps: [
      "online / in-app: Account Settings > Plan Settings > Pause/Cancel Subscription",
      "email: contact@blueapron.com (Terms 4.2 allow cancel by email)",
      "phone/text: (646) 891-4349",
    ],
    email: "contact@blueapron.com",
    sources: [
      "https://support.blueapron.com/hc/en-us/articles/203146687-How-do-I-cancel-my-account",
      "https://www.blueapron.com/pages/terms",
      "https://support.blueapron.com/hc/en-us/articles/204309963-How-do-I-contact-customer-service",
    ],
  },
  {
    merchant: "New York Times (digital)",
    aliases: ["new york times", "nytimes", "nyt"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "online: nytimes.com account > Subscription Overview > Cancel (path from third-party guides)",
      "chat: help.nytimes.com",
      "phone: 1-800-698-4637 (third-party; official page blocked to fetcher)",
    ],
    email: null,
    sources: [
      "https://help.nytimes.com/hc/en-us/articles/360003499613-Cancel-your-subscription",
      "https://news.bloomberglaw.com/class-action/nyt-to-pay-1-6-million-give-free-access-over-auto-renewals (third-party)",
      "https://www.online-tech-tips.com/how-to-cancel-your-new-york-times-subscription/ (third-party)",
    ],
  },
  {
    merchant: "Wall Street Journal",
    aliases: ["wall street journal", "wsj"],
    channel: "phone",
    fallback: "guided",
    steps: [
      "online: customercenter.wsj.com > Manage Subscriptions > Cancel (may not show for every account; third-party)",
      "phone: 1-800-JOURNAL (1-800-568-7625) (third-party)",
    ],
    email: null,
    sources: [
      "https://www.online-tech-tips.com/how-to-cancel-your-wall-street-journal-wsj-subscription/ (third-party)",
      "https://subger.com/en/us/cancel/wall-street-journal (third-party)",
    ],
  },
  {
    merchant: "Washington Post",
    aliases: ["washington post"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "online: My Post > Subscription & Billing > cancel (digital)",
      "online (print): My Post > Manage subscription > Cancel my subscription",
      "phone: 1-800-477-4679 (Mon-Fri 6am-6pm ET)",
      "chat: help center",
    ],
    email: null,
    sources: [
      "https://helpcenter.washingtonpost.com/hc/en-us/articles/360000177571-How-to-cancel-your-digital-only-subscription",
      "https://helpcenter.washingtonpost.com/hc/en-us/articles/115004026387-How-to-cancel-your-Washington-Post-print-subscription",
    ],
  },
  {
    merchant: "Verizon (wireless)",
    aliases: ["verizon wireless"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "port out: porting all numbers to a new carrier closes the account",
      "chat: My Verizon > Chat with us > Cancel",
      "phone: 800-922-0204",
    ],
    email: null,
    sources: [
      "https://www.verizon.com/support/disconnect-cancel-mobile/",
      "https://www.verizon.com/support/assign-account-manager-roles-faqs/",
      "https://www.verizon.com/support/customer-agreement/",
    ],
  },
  {
    merchant: "Verizon Fios (home)",
    aliases: ["verizon fios", "fios"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "chat: My Verizon > Settings & profile > Disconnect > Start chat",
      "phone: 1-800-VERIZON (800-837-4966)",
      "equipment return within 30 days",
    ],
    email: null,
    sources: ["https://www.verizon.com/support/residential/account/manage-service/cancel"],
  },
  {
    merchant: "AT&T (wireless)",
    aliases: ["at&t wireless", "att wireless"],
    channel: "phone",
    fallback: "guided",
    steps: [
      "port out first, then cancel (last line closes account)",
      "phone: 800.331.0500",
      "chat: when available",
      "online: att.com/attaccount only for IL, MA and NY accounts ordered online",
    ],
    email: null,
    sources: [
      "https://www.att.com/support/article/wireless/KM1008472/",
      "https://www.att.com/support/article/my-account/KM1040456/",
    ],
  },
  {
    merchant: "AT&T (internet)",
    aliases: ["at&t internet", "att internet"],
    channel: "phone",
    fallback: "guided",
    steps: [
      "phone: 800.288.2020 (account owner with account number and PIN)",
      "equipment return within 21 days at UPS Store or FedEx Office",
    ],
    email: null,
    sources: [
      "https://www.att.com/support/how-to/cancellation-policy-internet/",
      "https://www.att.com/support/how-to/internet/equipment-return/",
    ],
  },
  {
    merchant: "T-Mobile",
    aliases: ["t-mobile"],
    channel: "phone",
    fallback: "guided",
    steps: [
      "port out: line deactivates when number ports",
      "phone: 611 from a T-Mobile phone or 1-800-937-8997 (third-party / community)",
      "online: suspend only; cancel not available online (third-party)",
    ],
    email: null,
    sources: [
      "https://www.t-mobile.com/support/account/billing-responsible-party-and-authorized-users-consumer",
      "https://www.t-mobile.com/support/account/cancel-service",
      "https://www.joinchargeback.com/cancels/how-to-cancel-t-mobile (third-party)",
    ],
  },
  {
    merchant: "Comcast Xfinity",
    aliases: ["xfinity", "comcast"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "phone: 1-800-XFINITY (1-800-934-6489)",
      "online: xfinity.com/cancel (schedule a call / next-cycle stop)",
      "in-store: Xfinity Store",
      "equipment return: xfinity.com/returns, store, or UPS",
    ],
    email: null,
    sources: [
      "https://www.xfinity.com/cancel",
      "https://www.xfinity.com/support/articles/important-information-when-canceling-services",
      "https://www.xfinity.com/support/articles/returning-your-equipment",
    ],
  },
  {
    merchant: "Spectrum (Charter)",
    aliases: ["spectrum", "charter"],
    channel: "phone",
    fallback: "letter",
    steps: [
      "phone: 1-855-70-SPECTRUM (855-707-7328) per Spectrum Community moderators (third-party)",
      "in-store: Spectrum Store",
      "mail: written notice (FCC annual notice)",
      "equipment return: store or UPS Store",
    ],
    email: null,
    sources: [
      "https://www.spectrum.com/policies/annual-notice",
      "https://www.spectrum.com/policies/residential-general-terms-and-conditions-of-service",
      "https://community.spectrum.net/discussion/173787/how-do-i-cancel-services (third-party)",
    ],
  },
  {
    merchant: "Tinder",
    aliases: ["tinder"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "in-app / tinder.com: Profile > Manage Payment Account > cancel",
      "store: Apple / Google Play subscriptions",
      "mail: signed, dated notice to Tinder, Attn: Cancellations, P.O. Box 25472, Dallas, TX 75225",
    ],
    email: null,
    sources: [
      "https://www.help.tinder.com/hc/en-us/articles/115003554466-Cancel-your-subscription",
      "https://policies.tinder.com/terms/us/en/",
    ],
  },
  {
    merchant: "Bumble",
    aliases: ["bumble"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "in-app / bumble.com: Settings > Manage your subscription > Cancel",
      "store: Apple / Google Play subscriptions",
      "mail: Bumble, Attn.: Cancellations, P.O. Box 300940, Austin, TX 78703",
    ],
    email: null,
    sources: [
      "https://support.bumble.com/hc/en-us/articles/28534541366045-Canceling-subscriptions",
      "https://bumble.com/en-us/terms",
    ],
  },
  {
    merchant: "Hinge",
    aliases: ["hinge"],
    channel: "guided",
    fallback: "letter",
    steps: [
      "in-app: Account Settings > Cancel Subscription",
      "Stripe billing portal (direct billing)",
      "store: Apple / Google Play subscriptions",
      "mail: Hinge, Attn: Cancellations, P.O. Box 25472, Dallas, TX 75225",
      "email (CA and OH users only): hello@hinge.co",
    ],
    email: null,
    sources: [
      "https://help.hinge.co/hc/en-us/articles/36311108859411-Adjusting-or-Canceling-Your-Subscription",
      "https://hinge.co/terms",
    ],
  },
  {
    merchant: "SiriusXM",
    aliases: ["siriusxm"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "online: siriusxm.com/myaccount > Subscriptions",
      "chat: Chat with an agent now (help page)",
      "phone: 866-635-8641",
    ],
    email: null,
    sources: [
      "https://www.siriusxm.com/help/manage-or-cancel-service",
      "https://www.siriusxm.com/customer-agreement",
    ],
  },
  {
    merchant: "Ring (Ring Protect)",
    aliases: ["ring protect", "ring.com"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online: ring.com account > Plan > select plan > Cancel"],
    email: null,
    sources: [
      "https://ring.com/us/en/support/articles/0p7eu/Cancel-Ring-Protect-Subscription-Plan",
    ],
  },
  {
    merchant: "Chegg",
    aliases: ["chegg"],
    channel: "guided",
    fallback: "card_lock",
    steps: ["online (desktop only): My Account > Orders > Cancel Subscription"],
    email: null,
    sources: [
      "https://www.chegg.com/en/contactus?a=How-do-I-cancel-my-Chegg-Study-subscription---id--LiAlcgGuQN6HnOLVkrpNgw",
      "https://www.chegg.com/en-US/termsofuse/",
    ],
  },
  {
    merchant: "Walmart+",
    aliases: ["walmart+", "walmart plus"],
    channel: "guided",
    fallback: "phone",
    steps: [
      "online: Account > Walmart+ > Manage membership > Cancel",
      "phone: Walmart Customer Care (800) 924-9206",
    ],
    email: null,
    sources: [
      "https://www.walmart.com/help/article/manage-walmart-membership/126c9a990a944c3abd8531de52a87440",
      "https://corporate.walmart.com/policies",
    ],
  },
  {
    merchant: "Costco membership",
    aliases: ["costco"],
    channel: "phone",
    fallback: "guided",
    steps: [
      "in-person: warehouse membership counter (immediate refund)",
      "phone: Member Services 1-800-774-2678",
      "online: turn off auto-renewal only (not a cancel)",
    ],
    email: null,
    sources: [
      "https://customerservice.costco.com/app/answers/answer_view/a_id/1308/~/how-can-i-cancel-my-costco-membership",
      "https://customerservice.costco.com/app/answers/answer_view/a_id/8688/~/can-i-make-any-change-to-my-membership-via-live-chat",
      "https://customerservice.costco.com/app/answers/detail/a_id/1812/~/how-can-i-manage-membership-auto-renewal-online",
    ],
  },
  {
    merchant: "LinkedIn Premium",
    aliases: ["linkedin"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: Me > Premium features > Manage subscription > Cancel",
      "in-app: Premium features > Manage your subscription > Cancel",
      "no-login form (US): linkedin.com/help/linkedin/ask/PREMIUM-CANCEL",
    ],
    email: null,
    sources: [
      "https://www.linkedin.com/help/linkedin/answer/a545578",
      "https://www.linkedin.com/help/linkedin/answer/a1337140",
    ],
  },
  {
    merchant: "Patreon",
    aliases: ["patreon"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: Settings > Memberships > creator > Cancel paid membership",
      "in-app: creator page > membership menu > cancel",
    ],
    email: null,
    sources: [
      "https://support.patreon.com/hc/en-us/articles/360005502572-Canceling-a-paid-membership",
      "https://support.patreon.com/hc/en-us/articles/27992151772813-iOS-in-app-purchases-FAQ",
    ],
  },
  {
    merchant: "Calm",
    aliases: ["calm"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "online: calm.com > Settings > Manage Subscription > Cancel",
      "store: Apple / Google Play / Samsung Health",
    ],
    email: null,
    sources: [
      "https://support.calm.com/hc/en-us/articles/115002473607-How-to-Cancel-Your-Subscription-or-Free-Trial",
      "https://support.calm.com/hc/en-us/articles/115005144313-Canceling-a-Subscription-or-Free-Trial-Through-Apple",
    ],
  },
  {
    merchant: "Headspace",
    aliases: ["headspace"],
    channel: "guided",
    fallback: "email",
    steps: [
      "online (browser): headspace.com/subscription/manage > Cancel Membership",
      "email: help@headspace.com (if cancel button is missing)",
      "store: Apple / Google Play",
    ],
    email: "help@headspace.com",
    sources: [
      "https://help.headspace.com/hc/en-us/articles/115008364988-How-do-I-cancel-my-subscription",
      "https://help.headspace.com/hc/en-us/articles/115014780447-How-do-I-cancel-my-subscription-if-I-subscribed-on-Apple-App-Store-or-Google-Play",
    ],
  },
  {
    merchant: "Noom",
    aliases: ["noom"],
    channel: "guided",
    fallback: "card_lock",
    steps: [
      "in-app: profile > Settings > Manage Subscription",
      "online: account.noom.com > Cancel Subscription",
    ],
    email: null,
    sources: [
      "https://www.noom.com/support/faqs/subscription-and-billing/2025/10/how-to-cancel-your-noom-subscription-or-trial/",
      "https://www.noom.com/support/faqs/subscription-and-billing/2025/10/noom-refund-policy/",
    ],
  },
];
