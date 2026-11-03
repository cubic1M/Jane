-- Control totals: what did not add up in an upload's files. A default on a new column rewrites no rows.
ALTER TABLE "import_runs" ADD COLUMN "control_warnings" TEXT[] DEFAULT ARRAY[]::TEXT[];
