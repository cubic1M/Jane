-- Emergency switches that apply in seconds (src/lib/ops-switches.ts). Additive.
CREATE TABLE "ops_switches" (
    "name" TEXT NOT NULL,
    "on" BOOLEAN NOT NULL,
    "set_by" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "set_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ops_switches_pkey" PRIMARY KEY ("name")
);
