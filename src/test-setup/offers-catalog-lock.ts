import { Client } from "pg";

// The offers catalog's tables (market_offers, market_offer_events) are one set for everyone. Test
// files that write them take turns, or one sees the other's rows: main went red on 11-15 when
// catalog.integration ("expected [] to deeply equal [fdic.checking, … tbill.52w]") ran beside
// bad-readings.integration, which seeds the hand-kept offers. Each takes this lock for its whole
// file, on a connection of its own; it goes when that connection closes (plaid-counter-lock.ts).
const OFFERS_CATALOG_LOCK = 7_142_114;

export async function takeOffersCatalog(url: string): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [OFFERS_CATALOG_LOCK]);
  return async () => {
    await client.query("SELECT pg_advisory_unlock($1)", [OFFERS_CATALOG_LOCK]);
    await client.end();
  };
}
