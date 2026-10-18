// Prints SQL that inserts the merchant seed (src/config/merchant-seed.ts), skipping
// merchants already present. Used to write the seed into a migration:
//   node scripts/merchant-seed-sql.ts >> prisma/migrations/<name>/migration.sql
import { MERCHANT_SEED } from "../src/config/merchant-seed.ts";

const quote = (value: string | null) =>
  value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;

console.log("\n-- Seed: common subscriptions (src/config/merchant-seed.ts)");
for (const m of MERCHANT_SEED) {
  const aliases = `ARRAY[${m.aliases.map(quote).join(", ")}]::TEXT[]`;
  console.log(
    `INSERT INTO "merchants" ("id", "key", "name", "aliases", "category", "cancel_url", "support_url", "updated_at") VALUES (${quote(`seed_${m.key.replaceAll(" ", "_")}`)}, ${quote(m.key)}, ${quote(m.name)}, ${aliases}, ${quote(m.category)}, ${quote(m.cancelUrl)}, ${quote(m.supportUrl)}, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;`,
  );
}
