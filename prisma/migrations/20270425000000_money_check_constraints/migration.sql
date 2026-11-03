-- Business rules the database holds itself to (docs/money-rules.md). NOT VALID: each applies to
-- every new or changed row at once and scans nothing, so this is safe on any existing rows and
-- takes each table's lock only for a moment. Each predicate comes from reading what the code can
-- write, not from production's data. VALIDATE comes later, in its own migration, once a read-only
-- count of old rows comes back zero (the "Founder only" list).
SET LOCAL lock_timeout = '5s';

ALTER TABLE "budgets" ADD CONSTRAINT "ck_budgets_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "savings_goals" ADD CONSTRAINT "ck_savings_goals_target_positive" CHECK (target_cents > 0) NOT VALID;
ALTER TABLE "savings_goals" ADD CONSTRAINT "ck_savings_goals_saved_not_negative" CHECK (manual_saved_cents >= 0) NOT VALID;
ALTER TABLE "money_transfers" ADD CONSTRAINT "ck_money_transfers_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "goal_transfers" ADD CONSTRAINT "ck_goal_transfers_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "invite_codes" ADD CONSTRAINT "ck_invite_codes_uses_in_range" CHECK (uses >= 0 AND max_uses >= 0 AND uses <= max_uses) NOT VALID;
ALTER TABLE "alerts" ADD CONSTRAINT "ck_alerts_confidence_percent" CHECK (confidence_percent BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE "suggestions" ADD CONSTRAINT "ck_suggestions_confidence_percent" CHECK (confidence_percent BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE "suggestion_outcomes" ADD CONSTRAINT "ck_suggestion_outcomes_confidence_percent" CHECK (confidence_percent BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE "shared_charges" ADD CONSTRAINT "ck_shared_charges_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "shared_charges" ADD CONSTRAINT "ck_shared_charges_share_in_range" CHECK (partner_share_bps BETWEEN 0 AND 10000) NOT VALID;
ALTER TABLE "settlements" ADD CONSTRAINT "ck_settlements_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "jobs" ADD CONSTRAINT "ck_jobs_attempts_not_negative" CHECK (attempts >= 0) NOT VALID;
ALTER TABLE "jobs" ADD CONSTRAINT "ck_jobs_max_attempts_positive" CHECK (max_attempts > 0) NOT VALID;
ALTER TABLE "rate_limits" ADD CONSTRAINT "ck_rate_limits_count_not_negative" CHECK (count >= 0) NOT VALID;
ALTER TABLE "import_runs" ADD CONSTRAINT "ck_import_runs_rows_not_negative" CHECK (rows >= 0) NOT VALID;
ALTER TABLE "import_runs" ADD CONSTRAINT "ck_import_runs_dates_in_order" CHECK (from_date <= to_date) NOT VALID;
ALTER TABLE "documents" ADD CONSTRAINT "ck_documents_size_not_negative" CHECK (size_bytes >= 0) NOT VALID;
ALTER TABLE "liabilities" ADD CONSTRAINT "ck_liabilities_apr_not_negative" CHECK (apr_bps >= 0) NOT VALID;
ALTER TABLE "debt_terms" ADD CONSTRAINT "ck_debt_terms_apr_not_negative" CHECK (apr_bps >= 0) NOT VALID;
ALTER TABLE "debt_terms" ADD CONSTRAINT "ck_debt_terms_balance_not_negative" CHECK (balance_cents >= 0) NOT VALID;
ALTER TABLE "debt_terms" ADD CONSTRAINT "ck_debt_terms_minimum_not_negative" CHECK (minimum_payment_cents >= 0) NOT VALID;
ALTER TABLE "security_deposits" ADD CONSTRAINT "ck_security_deposits_amount_not_negative" CHECK (amount_cents >= 0) NOT VALID;
ALTER TABLE "security_deposits" ADD CONSTRAINT "ck_security_deposits_returned_not_negative" CHECK (returned_cents >= 0) NOT VALID;
ALTER TABLE "health_scores" ADD CONSTRAINT "ck_health_scores_score_in_range" CHECK (score BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE "merchant_outcomes" ADD CONSTRAINT "ck_merchant_outcomes_counts_in_order" CHECK (cases >= 0 AND succeeded >= 0 AND succeeded <= cases) NOT VALID;
ALTER TABLE "actions" ADD CONSTRAINT "ck_actions_refund_not_negative" CHECK (refund_cents >= 0) NOT VALID;
ALTER TABLE "actions" ADD CONSTRAINT "ck_actions_confirmed_not_negative" CHECK (confirmed_annual_cents >= 0) NOT VALID;
ALTER TABLE "crypto_holdings" ADD CONSTRAINT "ck_crypto_holdings_quantity_not_negative" CHECK (quantity >= 0) NOT VALID;
ALTER TABLE "auto_invest_plans" ADD CONSTRAINT "ck_auto_invest_plans_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "auto_invest_runs" ADD CONSTRAINT "ck_auto_invest_runs_amount_not_negative" CHECK (amount_cents >= 0) NOT VALID;
ALTER TABLE "gifts" ADD CONSTRAINT "ck_gifts_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "hsa_receipts" ADD CONSTRAINT "ck_hsa_receipts_amount_positive" CHECK (amount_cents > 0) NOT VALID;
ALTER TABLE "medical_bills" ADD CONSTRAINT "ck_medical_bills_amount_not_negative" CHECK (amount_cents >= 0) NOT VALID;
ALTER TABLE "tax_payments" ADD CONSTRAINT "ck_tax_payments_cents_positive" CHECK (cents > 0) NOT VALID;
ALTER TABLE "transactions" ADD CONSTRAINT "ck_transactions_csv_has_dedupe_key" CHECK (source <> 'csv' OR dedupe_key IS NOT NULL) NOT VALID;
