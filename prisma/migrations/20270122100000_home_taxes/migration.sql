-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "home_bought_on" DATE,
ADD COLUMN     "home_days_lived_in" INTEGER,
ADD COLUMN     "home_price_cents" INTEGER,
ADD COLUMN     "home_sale_cents" INTEGER,
ADD COLUMN     "home_sale_costs_cents" INTEGER,
ADD COLUMN     "home_sold_on" DATE,
ADD COLUMN     "points_cents" INTEGER,
ADD COLUMN     "points_loan_years" INTEGER,
ADD COLUMN     "points_purchase" BOOLEAN,
ADD COLUMN     "points_year" INTEGER;

