// The shareable result card and its invite link (src/lib/share-card.ts).

// Under this much found a year, the card says how many things Jane checked instead
// ("Jane checked N things. I'm in good shape."): a small dollar figure isn't worth bragging
// about, and the checkup is the better story.
export const SHARE_MIN_FOUND_CENTS = 100_00;

// The yearly total on the card is rounded down to a step, so it never shows an exact figure
// from the person's accounts: under the first bound to the nearest $10, then $50, then $100.
export const SHARE_ROUNDING: readonly { underCents: number; stepCents: number }[] = [
  { underCents: 1_000_00, stepCents: 10_00 },
  { underCents: 5_000_00, stepCents: 50_00 },
  { underCents: Number.POSITIVE_INFINITY, stepCents: 100_00 },
];

// How many friends one person's share link lets into the closed beta. Their link is one invite
// code (invite_codes, shared_by_id), reused every time they share.
export const SHARE_INVITE_MAX_USES = 10;
// And how many everyone's share links may let in together. Each person who joins gets a link of
// their own, so 1 becomes 10, then 100, in a beta meant for a few dozen, each with their own Claude
// allowance out of one month's total. Past this a share link says it's used up.
export const SHARE_INVITES_TOTAL = 50;

// What /admin/invites shows as the code's note.
export const SHARE_INVITE_NOTE = "Shared from a result card";

// Link previewers and crawlers fetch the invite page to draw its card; they aren't a friend
// opening it, so they don't count as opened.
export const LINK_PREVIEW_AGENTS =
  /bot|crawl|spider|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|embedly|skype|vkshare|pinterest|redditbot|applebot|google-pagerenderer/i;
