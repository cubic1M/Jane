import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The database refuses money that can't be (prisma/migrations/*_money_check_constraints). Each rule
// is shown both ways on a row that's otherwise fine: the good value goes in, the bad one is refused
// by name. A constraint added without a case here fails the last test.
const url = process.env.TEST_DATABASE_URL;

type Case = {
  table: string;
  constraint: string;
  good: Record<string, unknown>;
  bad: Record<string, unknown>;
};

const not = (
  table: string,
  constraint: string,
  column: string,
  good: unknown,
  bad: unknown,
  extra: Record<string, unknown> = {},
): Case => ({
  table,
  constraint,
  good: { ...extra, [column]: good },
  bad: { ...extra, [column]: bad },
});

const CASES: Case[] = [
  not("budgets", "ck_budgets_amount_positive", "amount_cents", 1, 0),
  not("savings_goals", "ck_savings_goals_target_positive", "target_cents", 1, 0),
  not("savings_goals", "ck_savings_goals_saved_not_negative", "manual_saved_cents", 0, -1),
  not("money_transfers", "ck_money_transfers_amount_positive", "amount_cents", 1, 0),
  not("goal_transfers", "ck_goal_transfers_amount_positive", "amount_cents", 1, -1),
  not("invite_codes", "ck_invite_codes_uses_in_range", "uses", 2, 3, { max_uses: 2 }),
  not("invite_codes", "ck_invite_codes_uses_in_range", "uses", 0, -1, { max_uses: 2 }),
  not("alerts", "ck_alerts_confidence_percent", "confidence_percent", 100, 101),
  not("suggestions", "ck_suggestions_confidence_percent", "confidence_percent", 0, -1),
  not(
    "suggestion_outcomes",
    "ck_suggestion_outcomes_confidence_percent",
    "confidence_percent",
    100,
    101,
  ),
  not("shared_charges", "ck_shared_charges_amount_positive", "amount_cents", 1, 0),
  not("shared_charges", "ck_shared_charges_share_in_range", "partner_share_bps", 10000, 10001),
  not("settlements", "ck_settlements_amount_positive", "amount_cents", 1, 0),
  not("jobs", "ck_jobs_attempts_not_negative", "attempts", 0, -1),
  not("jobs", "ck_jobs_max_attempts_positive", "max_attempts", 1, 0),
  not("rate_limits", "ck_rate_limits_count_not_negative", "count", 0, -1),
  not("import_runs", "ck_import_runs_rows_not_negative", "rows", 0, -1),
  not("import_runs", "ck_import_runs_dates_in_order", "to_date", "2026-10-02", "2026-09-30", {
    from_date: "2026-10-01",
  }),
  not("documents", "ck_documents_size_not_negative", "size_bytes", 0, -1),
  not("liabilities", "ck_liabilities_apr_not_negative", "apr_bps", 0, -1),
  not("debt_terms", "ck_debt_terms_apr_not_negative", "apr_bps", 0, -1),
  not("debt_terms", "ck_debt_terms_balance_not_negative", "balance_cents", 0, -1),
  not("debt_terms", "ck_debt_terms_minimum_not_negative", "minimum_payment_cents", 0, -1),
  not("security_deposits", "ck_security_deposits_amount_not_negative", "amount_cents", 0, -1),
  not("security_deposits", "ck_security_deposits_returned_not_negative", "returned_cents", 0, -1),
  not("health_scores", "ck_health_scores_score_in_range", "score", 100, 101),
  not("merchant_outcomes", "ck_merchant_outcomes_counts_in_order", "succeeded", 5, 6, { cases: 5 }),
  not("actions", "ck_actions_refund_not_negative", "refund_cents", 0, -1),
  not("actions", "ck_actions_confirmed_not_negative", "confirmed_annual_cents", 0, -1),
  not("crypto_holdings", "ck_crypto_holdings_quantity_not_negative", "quantity", 0, -0.5),
  not("auto_invest_plans", "ck_auto_invest_plans_amount_positive", "amount_cents", 1, 0),
  not("auto_invest_runs", "ck_auto_invest_runs_amount_not_negative", "amount_cents", 0, -1),
  not("gifts", "ck_gifts_amount_positive", "amount_cents", 1, 0),
  not("hsa_receipts", "ck_hsa_receipts_amount_positive", "amount_cents", 1, 0),
  not("medical_bills", "ck_medical_bills_amount_not_negative", "amount_cents", 0, -1),
  not("tax_payments", "ck_tax_payments_cents_positive", "cents", 1, 0),
  {
    table: "transactions",
    constraint: "ck_transactions_csv_has_dedupe_key",
    good: { source: "csv", dedupe_key: "key" },
    bad: { source: "csv", dedupe_key: null },
  },
  {
    table: "transactions",
    constraint: "ck_transactions_csv_has_dedupe_key",
    good: { source: "plaid", dedupe_key: null },
    bad: { source: "csv", dedupe_key: null },
  },
];

type Column = { name: string; type: string; udt: string; enumLabel: string | null };

describe.runIf(url)("money the database refuses", () => {
  const client = new Client({ connectionString: url });
  const columnsOf = new Map<string, Column[]>();

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  // Every required column with no default, so a row is valid but for what a case sets.
  async function required(table: string): Promise<Column[]> {
    const known = columnsOf.get(table);
    if (known) return known;
    const { rows } = await client.query<Column>(
      `SELECT c.column_name AS name, c.data_type AS type, c.udt_name AS udt,
              (SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = c.udt_name ORDER BY e.enumsortorder LIMIT 1) AS "enumLabel"
         FROM information_schema.columns c
        WHERE c.table_schema = current_schema() AND c.table_name = $1
          AND c.is_nullable = 'NO' AND c.column_default IS NULL`,
      [table],
    );
    columnsOf.set(table, rows);
    return rows;
  }

  function filler({ type, udt, enumLabel }: Column): unknown {
    if (enumLabel !== null) return enumLabel;
    if (type === "ARRAY") return [];
    if (type === "boolean") return true;
    if (type.startsWith("timestamp") || type === "date") return "2026-10-01";
    if (udt.startsWith("json")) return "{}";
    if (["integer", "bigint", "double precision", "numeric"].includes(type)) return 1;
    return `check-${crypto.randomUUID()}`;
  }

  // Inside a transaction that's rolled back, with foreign keys off for it: only the one rule is
  // being shown, not a whole person and everything they own.
  async function insert(table: string, values: Record<string, unknown>) {
    const row: Record<string, unknown> = {};
    for (const column of await required(table)) row[column.name] = filler(column);
    Object.assign(row, values);
    const names = Object.keys(row);
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")})
         VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
        names.map((n) => row[n]),
      );
    } finally {
      await client.query("ROLLBACK");
    }
  }

  it.each(CASES)("$constraint", async ({ table, constraint, good, bad }) => {
    await expect(insert(table, good)).resolves.toBeUndefined();
    await expect(insert(table, bad)).rejects.toMatchObject({ code: "23514", constraint });
  });

  it("has a case for every constraint, and every one is on the table it names", async () => {
    const { rows } = await client.query<{ name: string; table: string }>(
      `SELECT con.conname AS name, rel.relname AS "table"
         FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE con.contype = 'c' AND con.conname LIKE 'ck\\_%'`,
    );
    const found = rows.map((r) => `${r.table}.${r.name}`).sort();
    expect(found).toEqual([...new Set(CASES.map((c) => `${c.table}.${c.constraint}`))].sort());
  });
});
