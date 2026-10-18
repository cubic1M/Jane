// What the home dashboard shows.

// Where signed-in users go after sign-in. /home sends people without accounts to /connect.
export const HOME_PATH = "/home";

// "Coming up" on Today (spec step 79): bills and deadlines in the next this-many days (a
// month, including the same date next month), at most this many of them.
export const COMING_UP_DAYS = 31;
export const COMING_UP_LIMIT = 7;

// The first-weeks checklist shows for this many days after signing up, until every item
// is done or the person hides it.
export const CHECKLIST_DAYS = 28;
// "Look at your cards" is done after this many decisions (yes, no or do it myself).
export const CHECKLIST_CARDS_TO_REVIEW = 3;
