import type { Rule } from "./rule";

export const LOANS_AND_LAST: readonly Rule[] = [
  {
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    keywords: [
      "CINEMA",
      "CINEMAS",
      "THEATRE",
      "THEATRES",
      "THEATER",
      "AMC",
      "REGAL",
      "CINEMARK",
      "FANDANGO",
      // Television by satellite or stream, not a phone or internet bill.
      "DIRECTV",
      "DISH NETWORK",
    ],
  },
  { category: "FOOD_AND_DRINK_GROCERIES", keywords: ["MARKET", "FOODS"], direction: "out" },
  // Financial aid paid out to a student: moved money, like a loan disbursement, never a refund
  // of spending or taxable pay (night QA 10-30: "FAFSA DISBURSEMENT UC REFUND", $2,100 in,
  // uncategorized, cancelled a student's August spending).
  {
    category: "LOAN_DISBURSEMENTS_STUDENT",
    keywords: [
      "FAFSA",
      "FINANCIAL AID",
      "FIN AID",
      "PELL GRANT",
      "STUDENT AID",
      "SCHOLARSHIP",
      "DIRECT LOAN DISB",
      "STUDENT LOAN DISB",
      // Servicers' own words (debugger 11-03).
      "FEDLOAN DISB",
      "FEDLOAN DISBURSEMENT",
      "SALLIE MAE DISB",
      "SALLIE MAE DISBURSEMENT",
      "NELNET LOAN DISB",
      "NELNET DISB",
      "NELNET DISBURSEMENT",
      "MOHELA DISB",
      "MOHELA DISBURSEMENT",
      "AIDVANTAGE DISB",
      "AIDVANTAGE DISBURSEMENT",
    ],
    direction: "in",
  },
  // A payday loan or an app's cash advance landing in checking: borrowed money, never a refund
  // of spending (night QA 10-30: a server's "ADVANCE AMERICA LOAN", $400 in, uncategorized).
  // Paying back a cash advance app or payday lender: a debt, not a subscription (debugger 11-03: "Review your Dave Inc
  // Repayment subscription, could save $900 a year"). Its own membership stays a membership.
  // The two categories the profile reads to see a payday loan or a pay advance (debugger 11-04:
  // other loan payments here meant nobody who uploaded a file could read as in a payday cycle).
  {
    category: "LOAN_PAYMENTS_CASH_ADVANCES",
    pattern:
      /(?<![A-Z0-9])(?:ADVANCE AMERICA|CHECK INTO CASH|ACE CASH EXPRESS|SPEEDY CASH|CHECKSMART)/,
    direction: "out",
  },
  // Paying a debt collector is paying a debt, never a subscription to cancel (debugger 11-05:
  // "Is Midland Credit a subscription to cancel?", with a cancellation email to copy).
  {
    category: "LOAN_PAYMENTS_OTHER_PAYMENT",
    pattern:
      /(?<![A-Z0-9])(?:MIDLAND (?:CREDIT|FUNDING)|PORTFOLIO RECOVERY|LVNV FUNDING|CAVALRY (?:SPV|PORTFOLIO)|JEFFERSON CAPITAL|ENCORE CAPITAL|IC SYSTEM|CONVERGENT OUTSOURCING|ENHANCED RECOVERY|TRANSWORLD SYSTEMS|CREDIT COLLECTION SERV)/,
    direction: "out",
  },
  {
    category: "LOAN_PAYMENTS_EWA",
    pattern:
      /(?<![A-Z0-9])(?:(?:EARNIN|ACTIVEHOURS)(?!.*MEMBERSHIP)|(?:BRIGIT|MONEYLION(?: INSTACASH)?|DAVE INC)(?=.*(?:REPAY|PAYBACK|ADVANCE)))/,
    direction: "out",
  },
  {
    category: "LOAN_DISBURSEMENTS_CASH_ADVANCES",
    keywords: [
      "ADVANCE AMERICA",
      "CHECK INTO CASH",
      "ACE CASH EXPRESS",
      "SPEEDY CASH",
      "CHECKSMART",
      "EARNIN",
      "BRIGIT",
      "MONEYLION INSTACASH",
      "DAVE INC",
    ],
    direction: "in",
  },
  {
    category: "INCOME_OTHER",
    keywords: ["CASHBACK", "CASH BACK", "REWARDS CREDIT", "STATEMENT CREDIT", "REDEMPTION"],
    direction: "in",
  },
  { category: "TRANSFER_OUT_ACCOUNT_TRANSFER", keywords: ["TRANSFER"], direction: "out" },
  { category: "TRANSFER_IN_ACCOUNT_TRANSFER", keywords: ["TRANSFER"], direction: "in" },

  // Parking, before tickets: a parking ticket is parking, never an event.
  {
    category: "TRANSPORTATION_PARKING",
    keywords: ["PARKING", "PARKMOBILE", "SP PLUS"],
    direction: "out",
  },
  // Tickets and films by their words (a seat each, so two at one price aren't a double charge),
  // coffee roasters, warehouse stores and internet providers (CSV bench, round 9).
  {
    category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
    keywords: ["TICKETS", "TIX", "BOX OFFICE"],
    direction: "out",
  },
  {
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    keywords: ["FILM", "FILMS", "MOVIES"],
    direction: "out",
  },
  { category: "FOOD_AND_DRINK_COFFEE", keywords: ["ROASTERS", "ROASTERY", "ESPRESSO"] },
  { category: "GENERAL_MERCHANDISE_SUPERSTORES", keywords: ["WHOLESALE"] },
  { category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE", keywords: ["INTERNET"], direction: "out" },

  // A bar or a bakery by its kind (QA round 28: "HOLLOW OAK TAVERN", "BLUE HERON BAKERY").
  { category: "FOOD_AND_DRINK_RESTAURANT", keywords: ["TAVERN", "PUB", "SALOON", "BAR & GRILL"] },
  {
    category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
    keywords: ["BAKERY", "BAKE SHOP", "DONUTS", "PASTRY", "PATISSERIE", "BOULANGERIE"],
  },
  // A gift to a church or a charity, and insurance and loans by their own words (QA round 28:
  // "PARKSIDE COMMUNITY CHURCH", "LEMONADE INSURANCE", "HARBOR CREDIT UNION PMT").
  {
    category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    keywords: ["CHURCH", "MINISTRIES", "PARISH", "TITHE", "TITHES", "DONATION", "CHARITY"],
    direction: "out",
  },
  {
    category: "GENERAL_SERVICES_INSURANCE",
    keywords: ["INSURANCE", "ASSURANCE"],
    direction: "out",
  },
  {
    category: "LOAN_PAYMENTS_OTHER_PAYMENT",
    keywords: ["LOAN PMT", "LOAN PAYMENT", "CREDIT UNION PMT", "CU LOAN"],
    direction: "out",
  },
  // Still more kinds of place, in the words their names use (CSV bench, round 12): food by the
  // kind of cooking, sweets and drinks, shops by what they sell, and services, care, schooling,
  // fitness and government by their words. After the names, so a known name still wins.
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    keywords: [
      "CUISINE",
      "GRILLE",
      "KABOB",
      "KEBAB",
      "CURRY",
      "INDIAN",
      "MEXICAN",
      "CHINESE",
      "ITALIAN",
      "BREAKFAST",
      "BRUNCH",
      "SEAFOOD",
      "HIBACHI",
      "DUMPLING",
    ],
    direction: "out",
  },
  {
    category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
    keywords: [
      "ICE CREAM",
      "CREAMERY",
      "GELATO",
      "FROZEN YOGURT",
      "JUICE",
      "SMOOTHIE",
      "BAGEL",
      "BAGELS",
    ],
    direction: "out",
  },
  {
    category: "FOOD_AND_DRINK_COFFEE",
    keywords: ["TEA HOUSE", "TEAHOUSE", "BOBA"],
    direction: "out",
  },
  {
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    keywords: ["BOOKSTORE", "BOOKS", "BOOKSELLERS"],
    direction: "out",
  },
  {
    category: "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES",
    keywords: ["FLORIST", "FLOWERS", "GIFTS", "GIFT SHOP"],
    direction: "out",
  },
  {
    category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    keywords: ["JEWELERS", "JEWELRY", "BOUTIQUE", "OUTLET"],
    direction: "out",
  },
  {
    category: "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING",
    keywords: ["LAUNDRY", "LAUNDROMAT", "CLEANERS", "DRY CLEAN"],
    direction: "out",
  },
  {
    category: "GENERAL_SERVICES_POSTAGE_AND_SHIPPING",
    keywords: ["USPS", "POSTAL", "POST OFFICE", "UPS STORE", "FEDEX"],
    direction: "out",
  },
  { category: "GENERAL_SERVICES_STORAGE", keywords: ["SELF STORAGE", "STORAGE"], direction: "out" },
  {
    category: "MEDICAL_PRIMARY_CARE",
    keywords: [
      "HOSPITAL",
      "MEDICAL",
      "CHIROPRACTIC",
      "PHYSICAL THERAPY",
      "COUNSELING",
      "LABCORP",
      "ZOCDOC",
      "TELADOC",
      "QUEST DIAGNOSTICS",
    ],
    direction: "out",
  },
  {
    category: "GENERAL_SERVICES_CHILDCARE",
    keywords: ["DAYCARE", "DAY CARE", "CHILDCARE", "CHILD CARE", "PRESCHOOL"],
    direction: "out",
  },
  {
    category: "GENERAL_SERVICES_EDUCATION",
    keywords: ["UNIVERSITY", "COLLEGE", "ACADEMY", "TUITION", "SCHOOL", "BURSAR", "MEAL PLAN"],
    direction: "out",
  },
  {
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    keywords: ["FITNESS", "GYM", "YOGA", "PILATES", "CROSSFIT", "CLIMBING"],
    direction: "out",
  },
  {
    category: "PERSONAL_CARE_OTHER_PERSONAL_CARE",
    keywords: ["SPA", "MASSAGE", "WAXING"],
    direction: "out",
  },
  {
    category: "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
    keywords: ["DMV", "MOTOR VEHICLES", "COUNTY CLERK", "PASSPORT"],
    direction: "out",
  },

  // Toast ("TST*") is a till for restaurants only: whatever the place is called, it's a meal.
  // After the merchant names, so "TST* BLUE BOTTLE" is still coffee. (Square's "SQ *" serves
  // every kind of shop, so it says nothing.)
  { category: "FOOD_AND_DRINK_RESTAURANT", pattern: /(?:^|\s)TST\s*\*/ },

  // Last of the words, so a gym, a shop or a restaurant by its kind wins first ("IRON TEMPLE GYM",
  // "PHO HOA NOODLE"): other houses of worship, and a homeowners' association by its letters
  // (CSV bench, second tuning set).
  {
    category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    keywords: ["CHAPEL", "TEMPLE", "SYNAGOGUE", "MOSQUE", "MASJID", "CONGREGATION", "CATHEDRAL"],
    direction: "out",
  },
  { category: "RENT_AND_UTILITIES_OTHER_UTILITIES", keywords: ["HOA"], direction: "out" },

  // A card's own payment plan for a purchase: Apple Card's "MONTHLY INSTALLMENTS (6 OF 24)", its
  // Type "Installment". It pays off a phone, like buy now, pay later (debugger 11-06: "Review your
  // Apple subscription: could save about $499.44 a year").
  {
    category: "LOAN_PAYMENTS_OTHER_PAYMENT",
    pattern: /^MONTHLY INSTALLMENTS? \(\d+ OF \d+\)/,
    direction: "out",
  },
  { category: "LOAN_PAYMENTS_OTHER_PAYMENT", bankType: ["Installment"], direction: "out" },

  // The bank's own labels, when no keyword matched
  { category: "BANK_FEES_OTHER_BANK_FEES", bankType: ["FEE_TRANSACTION", "Fee"] },
  { category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", bankType: ["Payment"] },
  { category: "LOAN_PAYMENTS_OTHER_PAYMENT", bankType: ["LOAN_PMT"], direction: "out" },
  { category: "TRANSFER_OUT_WITHDRAWAL", bankType: ["ATM"], direction: "out" },
  // A customer paying through PayPal: a sale, by the statement's own type (debugger 11-02). A
  // friend's "General Payment" stays unread.
  {
    category: "INCOME_GIG_ECONOMY",
    bankType: ["Express Checkout Payment", "Website Payment"],
    direction: "in",
  },

  { category: "FOOD_AND_DRINK_GROCERIES", bankCategory: ["Groceries"], direction: "out" },
  // USAA's own category for pay (debugger 11-02: its cleaned "Lockheed Martin" matched nothing).
  { category: "INCOME_SALARY", bankCategory: ["Paycheck"], direction: "in" },
  // USAA's other plain names (night QA 11-03: its cleaned "Lejeune Rentals" matched no keyword, so
  // $1,450 of rent sat uncategorized on a statement that said what it was). One way only: money
  // back from a landlord isn't rent paid.
  { category: "RENT_AND_UTILITIES_RENT", bankCategory: ["Rent"], direction: "out" },
  { category: "GENERAL_SERVICES_CHILDCARE", bankCategory: ["Childcare"], direction: "out" },
  { category: "GENERAL_SERVICES_INSURANCE", bankCategory: ["Insurance"], direction: "out" },
  { category: "RENT_AND_UTILITIES_OTHER_UTILITIES", bankCategory: ["Utilities"], direction: "out" },
  { category: "INCOME_OTHER", bankCategory: ["Income"], direction: "in" },
  { category: "TRANSPORTATION_GAS", bankCategory: ["Gas"], direction: "out" },
  // A card's own categories (Chase's), in either direction, so a return nets against its
  // purchase. Broad, so last: the keyword rules above are more specific.
  { category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", bankCategory: ["Food & Drink"] },
  { category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", bankCategory: ["Shopping"] },
  { category: "TRAVEL_OTHER_TRAVEL", bankCategory: ["Travel"] },
  { category: "ENTERTAINMENT_OTHER_ENTERTAINMENT", bankCategory: ["Entertainment"] },
  { category: "MEDICAL_OTHER_MEDICAL", bankCategory: ["Health & Wellness"] },
  { category: "RENT_AND_UTILITIES_OTHER_UTILITIES", bankCategory: ["Bills & Utilities"] },
  { category: "TRANSPORTATION_OTHER_TRANSPORTATION", bankCategory: ["Automotive"] },
  { category: "HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT", bankCategory: ["Home"] },
  { category: "PERSONAL_CARE_OTHER_PERSONAL_CARE", bankCategory: ["Personal"] },
  { category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", bankCategory: ["Professional Services"] },
  { category: "GENERAL_SERVICES_EDUCATION", bankCategory: ["Education"] },
  { category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS", bankCategory: ["Gifts & Donations"] },
  { category: "BANK_FEES_OTHER_BANK_FEES", bankCategory: ["Fees & Adjustments"], direction: "out" },
  // Capital One's and Discover's card categories, and American Express's (its "Category"
  // column, "Restaurant-Restaurant", matched by the part before the dash). CSV bench: none
  // were read, so a card's restaurants were uncategorized without Claude.
  {
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    bankCategory: ["Payment/Credit", "Payments and Credits"],
    direction: "in",
  },
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    bankCategory: ["Dining", "Restaurants", "Restaurant-"],
  },
  {
    category: "FOOD_AND_DRINK_GROCERIES",
    bankCategory: ["Grocery", "Supermarkets", "Merchandise & Supplies-Groceries"],
  },
  {
    category: "TRANSPORTATION_GAS",
    bankCategory: ["Gas/Automotive", "Gasoline", "Transportation-Fuel"],
  },
  { category: "TRAVEL_FLIGHTS", bankCategory: ["Airfare", "Airlines", "Travel-Airline"] },
  { category: "TRAVEL_LODGING", bankCategory: ["Hotels", "Lodging"] },
  { category: "TRAVEL_RENTAL_CARS", bankCategory: ["Car Rental"] },
  { category: "TRAVEL_OTHER_TRAVEL", bankCategory: ["Other Travel", "Travel-"] },
  {
    category: "TRANSPORTATION_OTHER_TRANSPORTATION",
    bankCategory: ["Transportation", "Transportation-"],
  },
  { category: "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR", bankCategory: ["Alcohol"] },
  { category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE", bankCategory: ["Internet"] },
  { category: "GENERAL_MERCHANDISE_SUPERSTORES", bankCategory: ["Warehouse Clubs"] },
  { category: "HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT", bankCategory: ["Home Improvement"] },
  {
    category: "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
    bankCategory: ["Government Services"],
  },
  { category: "RENT_AND_UTILITIES_TELEPHONE", bankCategory: ["Phone/Cable", "Communications-"] },
  {
    category: "MEDICAL_OTHER_MEDICAL",
    bankCategory: ["Health Care", "Medical", "Medical Services"],
  },
  {
    category: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
    bankCategory: ["Travel/ Entertainment", "Entertainment-"],
  },
  { category: "GENERAL_MERCHANDISE_DEPARTMENT_STORES", bankCategory: ["Department Stores"] },
  {
    category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    bankCategory: ["Merchandise", "Merchandise & Supplies-"],
  },
  {
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    bankCategory: ["Other Services", "Services", "Business Services-"],
  },
  { category: "BANK_FEES_INTEREST_CHARGE", bankCategory: ["Interest"], direction: "out" },
  {
    category: "BANK_FEES_OTHER_BANK_FEES",
    bankCategory: ["Fee/Interest Charge", "Fees"],
    direction: "out",
  },
];
