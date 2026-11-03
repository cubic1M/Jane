// How many of a person's merchants are read as names to check an answer against.
export const FIGURE_NAMES_LIMIT = 500;

// Dates an answer may say without a tool giving them, as month * 100 + day: the year's fixed tax
// dates, and its first and last days.
export const CALENDAR_DATES: readonly number[] = [101, 115, 415, 615, 915, 1015, 1231];
