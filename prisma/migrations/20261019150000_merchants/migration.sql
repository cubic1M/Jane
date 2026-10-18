-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "cancel_url" TEXT,
    "support_url" TEXT,
    "support_phone" TEXT,
    "typical_monthly_cents" INTEGER,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_key_key" ON "merchants"("key");


-- Seed: common subscriptions (src/config/merchant-seed.ts)
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_netflix', 'netflix', 'Netflix', ARRAY['nflx', 'netflix inc']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', 'https://www.netflix.com/cancelplan', 'https://help.netflix.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_hulu', 'hulu', 'Hulu', ARRAY['hulu llc', 'hulu com']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', 'https://secure.hulu.com/account', 'https://help.hulu.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_disney_plus', 'disney plus', 'Disney+', ARRAY['disneyplus']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', 'https://www.disneyplus.com/account', 'https://help.disneyplus.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_max', 'max', 'Max', ARRAY['hbo max', 'hbomax']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', NULL, 'https://help.max.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_peacock', 'peacock', 'Peacock', ARRAY['peacocktv', 'peacock tv']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', 'https://www.peacocktv.com/account', NULL, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_paramount_plus', 'paramount plus', 'Paramount+', ARRAY['paramountplus']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', 'https://www.paramountplus.com/account/', NULL, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_youtube_premium', 'youtube premium', 'YouTube Premium', ARRAY['youtubepremium', 'google youtube premium', 'youtube tv']::TEXT[], 'ENTERTAINMENT_TV_AND_MOVIES', 'https://www.youtube.com/paid_memberships', NULL, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_spotify', 'spotify', 'Spotify', ARRAY['spotify usa', 'spotify ab']::TEXT[], 'ENTERTAINMENT_MUSIC_AND_AUDIO', 'https://www.spotify.com/account/subscription/', 'https://support.spotify.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_siriusxm', 'siriusxm', 'SiriusXM', ARRAY['sirius xm', 'sirius radio']::TEXT[], 'ENTERTAINMENT_MUSIC_AND_AUDIO', NULL, 'https://care.siriusxm.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_audible', 'audible', 'Audible', ARRAY['audible inc', 'audible us']::TEXT[], 'ENTERTAINMENT_MUSIC_AND_AUDIO', NULL, 'https://help.audible.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_apple', 'apple', 'Apple', ARRAY['apple com bill', 'itunes', 'itunes com']::TEXT[], NULL, 'https://apps.apple.com/account/subscriptions', 'https://support.apple.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_google_play', 'google play', 'Google Play', ARRAY['google play store']::TEXT[], NULL, 'https://play.google.com/store/account/subscriptions', NULL, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_amazon_prime', 'amazon prime', 'Amazon Prime', ARRAY['amzn prime', 'prime video', 'amazon prime video']::TEXT[], NULL, 'https://www.amazon.com/mc', NULL, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_dropbox', 'dropbox', 'Dropbox', ARRAY['dropbox inc']::TEXT[], NULL, 'https://www.dropbox.com/account/plan', 'https://help.dropbox.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_adobe', 'adobe', 'Adobe', ARRAY['adobe inc', 'adobe systems']::TEXT[], NULL, 'https://account.adobe.com/plans', 'https://helpx.adobe.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_microsoft', 'microsoft', 'Microsoft 365', ARRAY['msft']::TEXT[], NULL, 'https://account.microsoft.com/services', 'https://support.microsoft.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_new_york_times', 'new york times', 'The New York Times', ARRAY['nytimes', 'ny times', 'nyt']::TEXT[], 'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS', 'https://myaccount.nytimes.com', 'https://help.nytimes.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_peloton', 'peloton', 'Peloton', ARRAY['onepeloton', 'peloton interactive']::TEXT[], 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', NULL, 'https://support.onepeloton.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_planet_fitness', 'planet fitness', 'Planet Fitness', ARRAY['planetfitness', 'pf club fees']::TEXT[], 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', NULL, 'https://www.planetfitness.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_openai', 'openai', 'ChatGPT', ARRAY['chatgpt', 'openai chatgpt', 'openai chatgpt subscr']::TEXT[], NULL, NULL, 'https://help.openai.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES ('seed_duolingo', 'duolingo', 'Duolingo', ARRAY['duolingo inc']::TEXT[], NULL, NULL, 'https://support.duolingo.com', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
