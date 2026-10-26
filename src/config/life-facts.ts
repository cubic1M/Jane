// What Jane works out about a person's life from their payments (founder, 2026-10-26: "paint a
// rough picture of the person from their payments (kids, pets, college, and so on)"). Each fact
// is a signal family: PFC categories and/or words in the payee, and how much of it it takes
// before Jane says so. Thresholds live here, never inline (src/profile/life-facts.ts reads them).
//
// Not guessed, ever: health conditions, religion, politics, sexuality, immigration status.
// Health spending is only a cost category (HEALTH_COST_*), never a diagnosis; a church or a
// pharmacy's name is not read for what it might say about someone.

export type Signal = {
  // Plaid PFC categories (detailed) that count.
  categories?: readonly string[];
  // Words in the payee (upper-cased description) that count.
  words?: RegExp;
  // How many payments, in how many different months, before the signal counts.
  minMatches: number;
  minMonths: number;
};

// --- Children -----------------------------------------------------------------------------
// Childcare is the strongest sign (one payment is enough, as before). The others need a pattern:
// a toy shop twice is a gift, a school and a pediatrician across months is a child.
export const KIDS_SIGNALS = {
  childcare: {
    categories: ["GENERAL_SERVICES_CHILDCARE"],
    words:
      /DAY ?CARE|CHILD ?CARE|PRESCHOOL|MONTESSORI|NURSERY SCHOOL|BRIGHT HORIZONS|KINDERCARE|LA PETITE|AFTER ?SCHOOL|BABYSIT|CARE\.COM/,
    minMatches: 1,
    minMonths: 1,
  },
  school: {
    words:
      /SCHOOL DISTRICT|ELEMENTARY|MIDDLE SCHOOL|\bPTA\b|\bPTO\b|SCHOOL LUNCH|LUNCH ?MONEY|MYSCHOOLBUCKS|SCHOLASTIC|PARENTSQUARE|SCHOOL FEE|FIELD TRIP|YEARBOOK|SCHOOLCASH/,
    minMatches: 3,
    minMonths: 2,
  },
  pediatric: {
    words: /PEDIATRIC|PEDIATRICIAN|CHILDREN'?S (?:HOSPITAL|HEALTH|MEDICAL)|KIDS? DENTAL|PEDIATRIX/,
    minMatches: 2,
    minMonths: 2,
  },
  kidsStores: {
    words:
      /CARTER'?S|OSHKOSH|GYMBOREE|CHILDREN'?S PLACE|BUY ?BUY BABY|TOYS ?R ?US|BUILD-?A-?BEAR|\bLEGO\b|GAP ?KIDS|HANNA ANDERSSON|MELISSA & DOUG|\bKIDS\b/,
    minMatches: 4,
    minMonths: 3,
  },
  babyGoods: {
    words: /DIAPER|PAMPERS|HUGGIES|ENFAMIL|SIMILAC|GERBER|HONEST CO|\bBABY\b|BABYLIST|BABY WIPES/,
    minMatches: 3,
    minMonths: 2,
  },
} as const satisfies Record<string, Signal>;
// Labels for the evidence ("6 childcare and school payments in 7 months of data").
export const KIDS_SIGNAL_WORDS: Record<keyof typeof KIDS_SIGNALS, string> = {
  childcare: "childcare",
  school: "school",
  pediatric: "pediatric",
  kidsStores: "kids' store",
  babyGoods: "baby goods",
};
// This many different kinds of signal make it seen; fewer is a guess.
export const KIDS_SEEN_FAMILIES = 2;

// Baby goods count as a new baby only when all of them are this recent and nothing for children
// was bought before.
export const NEW_BABY_RECENT_DAYS = 150;

// --- Pets ---------------------------------------------------------------------------------
export const PET_SIGNAL: Signal = {
  categories: ["GENERAL_MERCHANDISE_PET_SUPPLIES", "MEDICAL_VETERINARY_SERVICES"],
  words:
    /CHEWY|PETCO|PETSMART|PET ?FOOD|PET SUPPL|BARKBOX|ROVER\.COM|\bWAG!?\b|GROOM|VETERINAR|\bVET\b|ANIMAL (?:HOSPITAL|CLINIC)|TRUPANION|EMBRACE PET|PETS BEST|BLUE BUFFALO|PURINA|FRESHPET|FARMER'?S DOG|OLLIE/,
  minMatches: 3,
  minMonths: 1,
};
// This many payments across at least two months is seen; fewer is a guess.
export const PET_SEEN_MATCHES = 4;

// --- School -------------------------------------------------------------------------------
// Tuition and campus bills. A student-loan payment is not read as "in school": it points to
// someone who finished (the student-loan detector has that on its own).
// The education category is not used on its own: it also holds online courses (Skillshare,
// Coursera, MasterClass), which a student and a non-student both pay.
export const STUDENT_SIGNAL: Signal = {
  words:
    /TUITION|UNIVERSITY|COLLEGE|BURSAR|CAMPUS|STUDENT (?:FEE|HOUSING|ACCOUNT|UNION|SERVICES)|BOOKSTORE|CHEGG|HOUSING AND DINING|REGISTRAR|MEAL PLAN|DINING PLAN/,
  minMatches: 2,
  minMonths: 1,
};
// Campus-only words: with enough of these across months it is seen (a parent paying tuition
// does not shop the campus bookstore every month).
export const STUDENT_CAMPUS_WORDS =
  /BOOKSTORE|CAMPUS|STUDENT (?:FEE|HOUSING|UNION)|MEAL PLAN|DINING PLAN/;
export const STUDENT_SEEN_CAMPUS_MATCHES = 3;

// --- Home and car -------------------------------------------------------------------------
// Homeowner bills beside the mortgage: dues and property tax say "own" on their own.
// Property tax twice a year is a guess (a renter can pay it through a landlord); monthly dues, or
// this many payments, are seen.
export const OWNER_SEEN_MATCHES = 4;
export const OWNER_SIGNAL: Signal = {
  words: /\bHOA\b|HOMEOWNERS? ASSOC|PROPERTY TAX|COUNTY TAX|TAX COLLECTOR/,
  minMatches: 2,
  minMonths: 2,
};
// What a car costs besides the loan and gas: parking, tolls, cover, upkeep.
export const CAR_SIGNAL: Signal = {
  categories: [
    "TRANSPORTATION_PARKING",
    "TRANSPORTATION_TOLLS",
    "GENERAL_SERVICES_AUTOMOTIVE",
    "LOAN_PAYMENTS_CAR_PAYMENT",
    "TRANSPORTATION_GAS",
  ],
  words:
    /GEICO|PROGRESSIVE|STATE FARM|AUTO INSURANCE|EZPASS|E-ZPASS|FASTRAK|SUNPASS|\bTOLL\b|CAR WASH|\bDMV\b|JIFFY LUBE|MIDAS|AUTOZONE|OIL CHANGE|CARMAX/,
  minMatches: 3,
  minMonths: 2,
};

// --- Getting about ------------------------------------------------------------------------
export const COMMUTE_SIGNAL: Signal = {
  categories: ["TRANSPORTATION_PUBLIC_TRANSIT", "TRANSPORTATION_PARKING", "TRANSPORTATION_TOLLS"],
  words:
    /\bMTA\b|\bBART\b|\bCTA\b|TRANSIT|CLIPPER|\bORCA\b|SEPTA|MBTA|WMATA|EZPASS|E-ZPASS|FASTRAK/,
  minMatches: 6,
  minMonths: 3,
};
// Remote is only a guess: a salary, this many months of data and no commute payments at all.
export const REMOTE_MIN_MONTHS = 4;
// ...and few fill-ups (a car commute would show as gas): at most this many a month.
export const REMOTE_MAX_GAS_PER_MONTH = 2;

export const TRAVEL_SIGNAL: Signal = {
  categories: ["TRAVEL_FLIGHTS", "TRAVEL_LODGING", "TRAVEL_RENTAL_CARS"],
  words:
    /AIRBNB|EXPEDIA|BOOKING\.COM|HOTELS?\.COM|VRBO|DELTA AIR|UNITED AIR|AMERICAN AIR|SOUTHWEST AIR|JETBLUE|ALASKA AIR|MARRIOTT|HILTON|HYATT/,
  minMatches: 1,
  minMonths: 1,
};
// A trip is a run of travel payments with no more than this many days between them; this many
// trips in a year make a frequent traveller.
export const TRIP_GAP_DAYS = 6;
export const TRIPS_FOR_FREQUENT = 3;

export const FITNESS_SIGNAL: Signal = {
  categories: ["PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"],
  words:
    /\bGYM\b|FITNESS|YMCA|YOGA|PILATES|CROSSFIT|PELOTON|CLASSPASS|ORANGETHEORY|PLANET FIT|EQUINOX|LA FITNESS|ANYTIME FIT|CRUNCH|BARRY'?S|SOULCYCLE|CLIMBING/,
  minMatches: 3,
  minMonths: 2,
};

// --- Food ---------------------------------------------------------------------------------
export const GROCERY_CATEGORIES = ["FOOD_AND_DRINK_GROCERIES"] as const;
export const EATING_OUT_CATEGORIES = [
  "FOOD_AND_DRINK_RESTAURANT",
  "FOOD_AND_DRINK_FAST_FOOD",
  "FOOD_AND_DRINK_COFFEE",
] as const;
export const DELIVERY_WORDS = /DOORDASH|UBER ?EATS|GRUBHUB|SEAMLESS|POSTMATES|CAVIAR/;
// At least this many food payments before saying; eating out is this share of food spending or
// more for "eats out", this share or less for "cooks", between for "mixed".
export const FOOD_MIN_PAYMENTS = 8;
export const EATS_OUT_SHARE = 0.6;
export const COOKS_SHARE = 0.35;

// --- Income and health costs --------------------------------------------------------------
// A side gig: a salary and this many gig or contractor deposits across at least two months.
export const SIDE_GIG_SIGNAL: Signal = {
  categories: ["INCOME_GIG_ECONOMY", "INCOME_CONTRACTOR"],
  words: /ETSY|UPWORK|FIVERR|TASKRABBIT|EBAY PAYOUT|STRIPE|SQUARE DEPOSIT|PAYPAL TRANSFER/,
  minMatches: 3,
  minMonths: 2,
};
// Health spending as a cost category, never a diagnosis: this much a month on average, from at
// least this many payments over at least this many months.
export const HEALTH_COST_MONTHLY_CENTS = 25_000;
export const HEALTH_COST_MIN_PAYMENTS = 6;
export const HEALTH_COST_MIN_MONTHS = 3;
// Veterinary bills are pets, not health.
export const HEALTH_COST_EXCLUDED = ["MEDICAL_VETERINARY_SERVICES"] as const;
