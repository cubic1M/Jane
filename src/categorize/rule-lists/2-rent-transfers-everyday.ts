import type { Rule } from "./rule";

export const RENT_TRANSFERS_EVERYDAY: readonly Rule[] = [
  // Money put into an investing app or a brokerage is moved, not spent (CSV bench, second tuning
  // set: "ACORNS INVEST" at $25 every month read as a subscription).
  {
    category: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    keywords: [
      "HSA BANK",
      "HSA CONTRIB",
      "HSA CONTRIBUTION",
      "ACORNS INVEST",
      "ACORNS*INVEST",
      "FID BKG SVC",
      "TD AMERITRADE",
      "TDAMERITRADE",
      "MERRILL EDGE",
      "ACORNS GROW",
      "STASH INVEST",
      "BETTERMENT",
      "WEALTHFRONT",
      "ROBINHOOD",
      "VANGUARD",
      "FIDELITY",
      "SCHWAB",
      "E*TRADE",
      "ETRADE",
      "M1 FINANCE",
      "PUBLIC.COM",
      "COINBASE",
      // Cash App's own bitcoin purchase (debugger 11-06: "Is Bitcoin Buy a subscription to cancel?").
      "BITCOIN BUY",
      "WEBULL",
      "SOFI INVEST",
      "IRA CONTRIB",
      "BROKERAGE",
      // College savings (night QA 10-30: a grandparent's "SCHOLARSHARE 529 CONTRIB" $100 a month
      // read as a subscription to cancel, "could save $1,200 a year").
      "529 CONTRIB",
      "529 PLAN",
      "529 COLLEGE",
      "529 DIRECT",
      "529 SAVINGS",
      "COLLEGE 529",
      "SCHOLARSHARE",
      "MY529",
      "COLLEGE SAVINGS PLAN",
      "COLLEGEADVANTAGE",
    ],
    direction: "out",
  },
  // Dues to a homeowners' or condo association: a home bill, not a plan.
  {
    category: "RENT_AND_UTILITIES_OTHER_UTILITIES",
    keywords: [
      "HOA DUES",
      "HOMEOWNERS ASSOC",
      "HOMEOWNERS ASSN",
      "HOMEOWNERS ASSOCIATION",
      "CONDO ASSOC",
      "CONDOMINIUM ASSOC",
      "PROPERTY OWNERS ASSOC",
    ],
    direction: "out",
  },

  // A flat's deposit and the moving truck come once (debugger 11-03: a $2,100 deposit counted as rent,
  // so a typical month carried it at full weight).
  {
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    keywords: [
      "SECURITY DEPOSIT",
      "APTS DEPOSIT",
      "APARTMENTS DEPOSIT",
      "RENT DEPOSIT",
      "UHAUL",
      "U-HAUL",
      "PENSKE TRUCK",
    ],
    direction: "out",
  },
  // What a payment app's line says it's for, before it reads as a transfer (debugger 11-05: alimony by
  // Zelle, asked about as rent, and $14,400 a year missing from spending; therapy by Venmo).
  {
    category: "GENERAL_SERVICES_CONSULTING_AND_LEGAL",
    keywords: ["ALIMONY", "SPOUSAL SUPPORT", "LAW OFFICES", "LAW OFFICE", "ATTORNEY AT LAW"],
    direction: "out",
  },
  {
    category: "MEDICAL_PRIMARY_CARE",
    pattern: /(?<!MASSAGE )(?<![A-Z0-9])(?:THERAPY|COUNSELING)(?![A-Z0-9])/,
    direction: "out",
  },
  // Rent, even when it goes by Zelle or Venmo (overnight upload QA: "ZELLE TO OAK RIDGE APTS
  // RENT" was a transfer, so a student's biggest bill was missing from spending and bills).
  // Renting a car or clothes is not rent, so those go first.
  {
    category: "TRAVEL_RENTAL_CARS",
    keywords: [
      "RENT-A-CAR",
      "RENT A CAR",
      "CAR RENTAL",
      "HERTZ",
      "AVIS",
      "BUDGET RENT",
      "ENTERPRISE RENT",
      "ALAMO RENT",
      "DOLLAR RENT",
      "FOX RENT",
    ],
    direction: "out",
  },
  {
    category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    keywords: ["RENT THE RUNWAY"],
    direction: "out",
  },
  // Cover a landlord buys, not rent paid to one (debugger 11-04).
  {
    category: "GENERAL_SERVICES_INSURANCE",
    keywords: ["LANDLORD INS", "LANDLORDS INS", "OBIE INS"],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_RENT",
    keywords: ["RENT", "APTS", "APARTMENTS", "PROPERTY MGMT", "PROPERTY MANAGEMENT", "LANDLORD"],
    direction: "out",
  },

  // Moving money to one's own savings: not spending (overnight upload QA: "TRANSFER TO SAV
  // XXXXX4410" was uncategorised, so it counted as spending and showed as a $300 bill).
  {
    category: "TRANSFER_OUT_SAVINGS",
    keywords: ["TO SAV", "TO SAVINGS", "SAVINGS TRANSFER", "TRANSFER TO SAVINGS"],
    direction: "out",
  },
  {
    category: "TRANSFER_IN_SAVINGS",
    keywords: ["FROM SAV", "FROM SAVINGS"],
    direction: "in",
  },

  // Transfers between people and accounts
  // Own-account moves as the banks word them (CSV bench: Bank of America's "Online Banking
  // transfer to SAV", Capital One's "Withdrawal to 360 Performance Savings").
  {
    category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    keywords: [
      "ZELLE",
      "VENMO",
      "CASH APP",
      "TRANSFER TO",
      // As banks shorten it (debugger 11-02: 12 of 55 wordings matched nothing, so a move to savings
      // counted as spending).
      "TRNSFR",
      "XFER",
      "TRF TO",
      "APPLE CASH SENT",
      // Money sent to someone abroad, as Zelle to a person is (debugger 11-02: Jane wasn't sure what
      // a nurse's monthly Remitly was).
      "REMITLY",
      "XOOM",
      "WESTERN UNION",
      "MONEYGRAM",
      "WORLDREMIT",
      "RIA FINANCIAL",
      "RIA MONEY",
      "SENDWAVE",
      "TRANSFERWISE",
      "WISE US",
      // Into the person's own health savings account (night QA 10-30: "HEALTHEQUITY DES:HSA
      // CONTRB" counted as $150 a month of spending).
      "HEALTHEQUITY",
      "HSA CONTRB",
      "HSA CONTRIB",
      "360 PERFORMANCE SAVINGS",
      "360 SAVINGS",
    ],
    direction: "out",
  },
  {
    category: "TRANSFER_IN_ACCOUNT_TRANSFER",
    keywords: [
      "ZELLE",
      "VENMO",
      "CASH APP",
      "TRANSFER FROM",
      "360 CHECKING",
      "TRNSFR",
      "XFER",
      "TRF FROM",
    ],
    direction: "in",
  },
  {
    category: "TRANSFER_OUT_WITHDRAWAL",
    // Bank of America writes "BKOFAMERICA ATM 10/03 #000001234 WITHDRWL" (CSV bench).
    keywords: ["ATM WITHDRAWAL", "CASH WITHDRAWAL", "WITHDRWL"],
    direction: "out",
  },

  // An airline ticket: card descriptors carry its 13-digit number (a 3-digit airline code, then
  // the ticket), whatever the airline ("UNITED 0162345678901", "SOUTHWES 5262123456789"). So
  // a group's fares aren't a double charge (CSV bench).
  { category: "TRAVEL_FLIGHTS", pattern: /(?<![0-9])[0-9]{13}(?![0-9])/ },

  // Well-known merchants
  {
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    keywords: [
      "NYTIMES",
      "NYT DIGITAL",
      "WSJ",
      "WASHINGTON POST",
      "WAPO",
      "THE ATLANTIC",
      "SUBSTACK",
    ],
  },
  // Tax software and preparers, above Intuit's other software ("INTUIT *TURBOTAX").
  {
    category: "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
    keywords: ["TURBOTAX", "H&R BLOCK", "HRB TAX", "TAXACT", "JACKSON HEWITT", "FREETAXUSA"],
    direction: "out",
  },
  // A business paying its staff through a payroll service: money out, so never someone's paycheck
  // (debugger 11-05: a shop's biggest category was "Uncategorized").
  {
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    keywords: ["GUSTO", "ADP", "PAYCHEX", "TRINET", "RIPPLING", "JUSTWORKS"],
    direction: "out",
  },
  {
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    keywords: [
      // Business software by the month (CSV bench, second tuning set: QuickBooks, Autodesk).
      "INTUIT",
      "QUICKBOOKS",
      "QBOOKS",
      "AUTODESK",
      "ATLASSIAN",
      "JETBRAINS",
      "SALESFORCE",
      "HUBSPOT",
      "MAILCHIMP",
      "OPENAI",
      "CHATGPT",
      "ADOBE",
      "DROPBOX",
      "MICROSOFT 365",
      "GOOGLE STORAGE",
      "ICLOUD",
      "APPLE.COM/BILL",
    ],
  },
  {
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    keywords: [
      "NETFLIX",
      "HULU",
      "DISNEY PLUS",
      "DISNEYPLUS",
      "HBO MAX",
      "MAX.COM",
      "PEACOCK",
      "PARAMOUNT+",
      "STARZ",
      "YOUTUBEPREMIUM",
      "YOUTUBE PREMIUM",
      "YOUTUBE TV",
    ],
  },
  {
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    keywords: ["SPOTIFY", "PANDORA", "SIRIUSXM", "SIRIUS XM", "AUDIBLE", "TIDAL"],
  },
  {
    category: "ENTERTAINMENT_VIDEO_GAMES",
    keywords: ["STEAMGAMES", "PLAYSTATION", "XBOX", "NINTENDO"],
  },
  {
    category: "FOOD_AND_DRINK_COFFEE",
    keywords: ["STARBUCKS", "DUNKIN", "PEET'S", "PEETS", "BLUE BOTTLE", "COFFEE", "CAFE"],
  },
  {
    category: "FOOD_AND_DRINK_FAST_FOOD",
    keywords: [
      "MCDONALD'S",
      "MCDONALDS",
      "BURGER KING",
      "TACO BELL",
      "WENDY'S",
      "WENDYS",
      "CHICK-FIL-A",
      "CHIPOTLE",
      "SUBWAY",
      "DOMINO'S",
      "PIZZA HUT",
      "PANERA",
      "FIVE GUYS",
      "SHAKE SHACK",
      "POPEYES",
      "KFC",
      "SONIC DRIVE",
      "JACK IN THE BOX",
      "IN-N-OUT",
    ],
  },
  // Sit-down chains, by name; the rest come from the card's own category or Claude.
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    keywords: [
      // A college's dining hall (night QA 10-30: a student's "UC DINING HALL", 90 charges and
      // most of their food, had no category).
      "DINING HALL",
      "DINING SERVICES",
      "CAMPUS DINING",
      "OLIVE GARDEN",
      "APPLEBEE'S",
      "CHILI'S",
      "CHEESECAKE FACTORY",
      "RED ROBIN",
      "IHOP",
      "DENNY'S",
      "OUTBACK",
      "TEXAS ROADHOUSE",
      "BUFFALO WILD WINGS",
      "SWEETGREEN",
      "CAVA",
    ],
  },
  {
    category: "FOOD_AND_DRINK_GROCERIES",
    keywords: [
      "WHOLE FOODS",
      "WHOLEFDS",
      "TRADER JOE",
      "SAFEWAY",
      // Debugger 11-03: regional chains left uncategorized.
      "SHAWS",
      "SHAW'S",
      "SMITHS FOOD",
      "SMITH'S FOOD",
      "TOM THUMB",
      "BI-LO",
      "FOOD CITY",
      "PCC COMMUNITY",
      // Night QA 10-30: "RALEYS #322" was uncategorized.
      "RALEYS",
      "RALEY'S",
      "KROGER",
      "PUBLIX",
      "ALDI",
      "WEGMANS",
      "SPROUTS",
      "H-E-B",
      "HEB",
      "MEIJER",
      "HY-VEE",
      "FOOD LION",
      "STOP & SHOP",
      "ALBERTSONS",
      "VONS",
      "RALPHS",
      "HARRIS TEETER",
      "WINCO",
      "GIANT EAGLE",
      "FRED MEYER",
    ],
  },
  // A driver's or shopper's pay from a gig platform, before the ride-share and delivery rules
  // (night QA 10-30: "UBER USA 6787 EDI PAYMNT" read as a taxi refund and "DOORDASH DASHER
  // PAYOUT" as a restaurant refund, so $10,600 of pay netted against spending, "Spent this
  // month $691" with $1,400 of rent, and taxes saw no income).
  {
    category: "INCOME_GIG_ECONOMY",
    pattern:
      /(?<![A-Z0-9])(?:UBER|LYFT|DOORDASH|GRUBHUB|INSTACART|SHIPT|POSTMATES)(?![A-Z0-9]).*(?<![A-Z0-9])(?:PAYOUT|PAYMNT|PAYMENT|EARNINGS|DASHER|DRIVER|SHOPPER|EDI|DIRECT DEP|INSTANT PAY|EXPRESS PAY|TECHNOLOGI(?:ES)?)(?![A-Z0-9])/,
    direction: "in",
  },
  { category: "INCOME_GIG_ECONOMY", keywords: ["AMAZON FLEX"], direction: "in" },
  // Food delivery before ride shares, so "UBER EATS" isn't a taxi.
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    keywords: ["UBER EATS", "UBER *EATS", "UBEREATS", "DOORDASH", "GRUBHUB", "POSTMATES"],
  },
  { category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", keywords: ["UBER", "LYFT"] },
  {
    category: "TRANSPORTATION_GAS",
    keywords: [
      "SHELL OIL",
      "CHEVRON",
      "EXXON",
      "EXXONMOBIL",
      "MOBIL",
      "ARCO",
      "SUNOCO",
      // Debugger 11-03: chains left uncategorized. "LOVES" and "PILOT" alone name other things.
      "CASEYS",
      "CASEY'S",
      "MAVERIK",
      "LOVES TRAVEL",
      "SINCLAIR",
      "BUC-EE",
      "BUCEES",
      // Night QA 10-30: a Midwest chain left uncategorized ("HOLIDAY STATIONSTORES 0412").
      "STATIONSTORES",
      "HOLIDAY STATION",
    ],
  },
  // Money in from a marketplace is a seller's payout, not a return (life bench, #798).
  {
    category: "INCOME_GIG_ECONOMY",
    keywords: ["ETSY PAYOUT", "ETSY DEPOSIT", "EBAY PAYOUT", "EBAY COMMERCE"],
    direction: "in",
  },
  // With the company's own words between ("ETSY, INC. PAYOUT 8842"; debugger 11-02: $5,455 of a
  // seller's income was a refund on shopping). A shopper's refund says neither word.
  {
    category: "INCOME_GIG_ECONOMY",
    pattern:
      /(?<![A-Z0-9])(?:ETSY|EBAY|POSHMARK|MERCARI|DEPOP)(?![A-Z0-9]).*(?<![A-Z0-9])(?:PAYOUT|DEPOSIT|EARNINGS)(?![A-Z0-9])/,
    direction: "in",
  },
  {
    category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    keywords: ["AMAZON", "AMZN", "EBAY", "ETSY"],
  },
  {
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    keywords: ["TARGET", "WALMART", "WAL-MART", "WM SUPERCENTER", "COSTCO"],
  },
  {
    category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
    keywords: ["CVS", "WALGREENS", "RITE AID", "GOODRX"],
  },
  // Short names that are ordinary words alone, so a number has to follow (debugger 11-03).
  {
    category: "TRANSPORTATION_GAS",
    pattern: /^(?:PILOT(?: TRAVEL)?|LOVE'?S)\s+#?\d|^MARATHON PETRO/,
  },
  { category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES", pattern: /^GAP\s+#?\d/ },
  { category: "GENERAL_MERCHANDISE_CONVENIENCE_STORES", keywords: ["7-ELEVEN", "7 ELEVEN"] },
  {
    category: "GENERAL_MERCHANDISE_ELECTRONICS",
    // "BESTBUY.COM": Best Buy's online orders, one word (debugger 11-01).
    keywords: ["BEST BUY", "BESTBUY", "APPLE STORE", "MICRO CENTER"],
  },
  {
    category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    keywords: [
      "TJ MAXX",
      "T J MAXX",
      "TJMAXX",
      "MARSHALLS",
      "ROSS STORES",
      "OLD NAVY",
      "H&M",
      "ZARA",
      "UNIQLO",
      "NORDSTROM RACK",
    ],
  },
  {
    category: "HOME_IMPROVEMENT_HARDWARE",
    keywords: ["HOME DEPOT", "LOWE'S", "LOWES", "ACE HARDWARE", "MENARDS"],
  },
  // A cable company's phone plan is a phone bill (before its cable name below).
  {
    category: "RENT_AND_UTILITIES_TELEPHONE",
    keywords: ["XFINITY MOBILE", "SPECTRUM MOBILE"],
  },
  {
    category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    keywords: ["COMCAST", "XFINITY", "SPECTRUM"],
  },
  // Prepaid carriers too: a phone plan is a bill, not a subscription to cancel (QA round 12:
  // "MINT MOBILE $30" came up as "Review your Mint Mobile subscription"). Carriers bill under
  // shorter names than their brand ("TMOBILE AUTOPAY", "VZWRLSS*APOCC VISB", "ATT*BILL
  // PAYMENT"; debugger 10-30), so those are here too.
  {
    category: "RENT_AND_UTILITIES_TELEPHONE",
    keywords: [
      "VERIZON",
      "VZWRLSS",
      "VZW",
      "AT&T",
      "AT T MOBILITY",
      "ATT*BILL",
      "ATT* BILL",
      "ATT BILL",
      "ATT MOBILITY",
      "T-MOBILE",
      "TMOBILE",
      "T MOBILE",
      "VISIBLE SERVICE",
      "VISIBLE WIRELESS",
      "TING MOBILE",
      "ULTRA MOBILE",
      "PAGE PLUS",
      "MINT MOBILE",
      "BOOST MOBILE",
      "US MOBILE",
      "GOOGLE FI",
      "GOOGLE *FI",
      "TRACFONE",
      "STRAIGHT TALK",
      "CRICKET",
    ],
  },
  // Rent that names no "RENT" (a bare "RENT" is caught above, after car rentals).
  {
    category: "RENT_AND_UTILITIES_RENT",
    keywords: [
      "PROPERTY MGMT",
      "PROPERTY MANAGEMENT",
      "RENT PAYMENT",
      "BILT RENT",
      "RENTCAFE",
      "APPFOLIO",
    ],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    keywords: [
      "PG&E",
      // How some banks spell it (night QA 10-30: "PGANDE WEB ONLINE").
      "PGANDE",
      // City-owned utilities (night QA 10-30: "SMUD DES:UTIL BILL" was uncategorized).
      "SMUD",
      "LADWP",
      "CON ED",
      "CONED",
      "SDGE",
      "CONEDISON",
      "DUKE ENERGY",
      "SCE",
      "COMED",
      "NATIONAL GRID",
      // Utilities named for what they sell (accuracy bench: "XCEL ENERGY", "SOUTHERN
      // CALIFORNIA EDISON" were never bills).
      "ENERGY",
      "ELECTRIC",
      "EDISON",
      "GAS & ELECTRIC",
      "GAS CO",
      "GAS COMPANY",
    ],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_WATER",
    keywords: ["WATER UTIL", "WATER DEPT"],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_OTHER_UTILITIES",
    keywords: ["UTILITIES", "UTILITY"],
    direction: "out",
  },
  // A copay is a visit, not the plan's premium, even with the insurer's name on it (debugger
  // 11-02: "KAISER PERMANENTE COPAY" was insurance, so the tax pack's medical left it out).
  { category: "MEDICAL_PRIMARY_CARE", keywords: ["COPAY", "CO-PAY"], direction: "out" },
  {
    category: "GENERAL_SERVICES_INSURANCE",
    keywords: [
      "GEICO",
      "PROGRESSIVE",
      "STATE FARM",
      "ALLSTATE",
      "LIBERTY MUTUAL",
      "LEMONADE INS",
      "NATIONWIDE",
      // A Medicare supplement or Advantage plan is health cover the person pays (night QA 10-30).
      "MEDICARE SUPP",
      "MEDICARE SUPPLEMENT",
      "MEDIGAP",
      // Part B's premium paid directly, and the AARP plan as UnitedHealthcare bills it (debugger
      // 11-03: $387 a month uncategorized for a retiree).
      "MEDICARE PREMIUM",
      "CMS MEDICARE",
      "CMS MED INS",
      "AARP UHC",
      "AARP SUPPLEMENTAL",
      "AARP MEDICARE",
      "AARP HEALTH",
      "UHC SUPPLEMENT",
    ],
  },
  {
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    // "PLANET FIT CLUB FEES": how Planet Fitness writes itself on a card (debugger 11-02).
    keywords: [
      "PLANET FITNESS",
      "PLANET FIT",
      "EQUINOX",
      "ORANGETHEORY",
      "24 HOUR FITNESS",
      "PELOTON",
    ],
  },
  { category: "TRAVEL_LODGING", keywords: ["AIRBNB", "MARRIOTT", "HILTON", "HYATT"] },
  // Ticket sellers: a seat each, so two at one price aren't a double charge (accuracy bench).
  {
    category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
    keywords: [
      "TICKETMASTER",
      "LIVE NATION",
      "STUBHUB",
      "SEATGEEK",
      "VIVID SEATS",
      "EVENTBRITE",
      "AXS",
      "TICKETWEB",
    ],
    direction: "out",
  },
];
