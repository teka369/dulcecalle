-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'staff');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('paid', 'partial', 'credit');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('Efectivo', 'Nequi');

-- CreateEnum
CREATE TYPE "StockMoveReason" AS ENUM ('inicial', 'surtir', 'sale', 'me_lo_comi', 'regalar', 'perdido', 'devolucion', 'adjust');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "CashMoveKind" AS ENUM ('sale', 'debt_collect', 'expense', 'retiro', 'aporte', 'compra', 'devolucion');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_memberships" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "price" BIGINT NOT NULL,
    "avg_cost" BIGINT NOT NULL,
    "stock" INTEGER NOT NULL,
    "low_stock_at" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "legacy_dexie_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "request_id" UUID,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "debt" BIGINT NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "legacy_dexie_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "legacy_dexie_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("business_id","key")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID,
    "payment_kind" "PaymentKind" NOT NULL,
    "method" "PayMethod",
    "sale_total" BIGINT NOT NULL,
    "amount_received" BIGINT NOT NULL,
    "credit" BIGINT NOT NULL,
    "request_id" UUID,
    "legacy_request_id" TEXT,
    "note" TEXT,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "refund_amount" BIGINT NOT NULL,
    "debt_reduced" BIGINT NOT NULL,
    "method" "PayMethod",
    "request_id" UUID,
    "note" TEXT,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_moves" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "StockMoveReason" NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "supplier_id" UUID,
    "ref_type" TEXT,
    "ref_id" UUID,
    "note" TEXT,
    "request_id" UUID,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "opening_float" BIGINT NOT NULL,
    "closing_count" BIGINT,
    "expected_efectivo" BIGINT,
    "expected_nequi" BIGINT,
    "difference" BIGINT,
    "note" TEXT,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_moves" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "method" "PayMethod" NOT NULL,
    "kind" "CashMoveKind" NOT NULL,
    "session_id" UUID,
    "ref_type" TEXT,
    "ref_id" UUID,
    "request_id" UUID,
    "note" TEXT,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "cash_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "method" "PayMethod" NOT NULL,
    "request_id" UUID,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "PayMethod" NOT NULL,
    "sale_id" UUID,
    "request_id" UUID,
    "note" TEXT,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initial_debts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT,
    "request_id" UUID,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_dexie_id" INTEGER,

    CONSTRAINT "initial_debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_id_map" (
    "business_id" UUID NOT NULL,
    "table_name" TEXT NOT NULL,
    "dexie_id" INTEGER NOT NULL,
    "pg_id" UUID NOT NULL,

    CONSTRAINT "import_id_map_pkey" PRIMARY KEY ("business_id","table_name","dexie_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "business_memberships_business_id_user_id_key" ON "business_memberships"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "products_business_id_idx" ON "products"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_request_id_key" ON "products"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_legacy_dexie_id_key" ON "products"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "customers_business_id_debt_idx" ON "customers"("business_id", "debt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_legacy_dexie_id_key" ON "customers"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_business_id_legacy_dexie_id_key" ON "suppliers"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "sales_business_id_occurred_on_idx" ON "sales"("business_id", "occurred_on");

-- CreateIndex
CREATE INDEX "sales_business_id_customer_id_idx" ON "sales"("business_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_business_id_request_id_key" ON "sales"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_business_id_legacy_dexie_id_key" ON "sales"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "sale_lines_business_id_sale_id_idx" ON "sale_lines"("business_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_business_id_legacy_dexie_id_key" ON "sale_lines"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "sale_returns_business_id_occurred_on_idx" ON "sale_returns"("business_id", "occurred_on");

-- CreateIndex
CREATE INDEX "sale_returns_business_id_sale_id_idx" ON "sale_returns"("business_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_business_id_request_id_key" ON "sale_returns"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_business_id_legacy_dexie_id_key" ON "sale_returns"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_lines_business_id_legacy_dexie_id_key" ON "sale_return_lines"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "stock_moves_business_id_occurred_on_idx" ON "stock_moves"("business_id", "occurred_on");

-- CreateIndex
CREATE INDEX "stock_moves_business_id_product_id_created_at_idx" ON "stock_moves"("business_id", "product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_moves_business_id_request_id_key" ON "stock_moves"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_moves_business_id_legacy_dexie_id_key" ON "stock_moves"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_business_id_local_date_key" ON "cash_sessions"("business_id", "local_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_business_id_legacy_dexie_id_key" ON "cash_sessions"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "cash_moves_business_id_occurred_on_idx" ON "cash_moves"("business_id", "occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "cash_moves_business_id_request_id_key" ON "cash_moves"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_moves_business_id_legacy_dexie_id_key" ON "cash_moves"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "expenses_business_id_occurred_on_idx" ON "expenses"("business_id", "occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_business_id_request_id_key" ON "expenses"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_business_id_legacy_dexie_id_key" ON "expenses"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "customer_payments_business_id_occurred_on_idx" ON "customer_payments"("business_id", "occurred_on");

-- CreateIndex
CREATE INDEX "customer_payments_business_id_customer_id_idx" ON "customer_payments"("business_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_business_id_request_id_key" ON "customer_payments"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_business_id_legacy_dexie_id_key" ON "customer_payments"("business_id", "legacy_dexie_id");

-- CreateIndex
CREATE INDEX "initial_debts_business_id_customer_id_idx" ON "initial_debts"("business_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "initial_debts_business_id_request_id_key" ON "initial_debts"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "initial_debts_business_id_legacy_dexie_id_key" ON "initial_debts"("business_id", "legacy_dexie_id");

-- AddForeignKey
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_fkey" FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_debts" ADD CONSTRAINT "initial_debts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_debts" ADD CONSTRAINT "initial_debts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_id_map" ADD CONSTRAINT "import_id_map_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain CHECKs (DATABASE.md). Prisma cannot express these in schema.
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonneg" CHECK (price >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_avg_cost_nonneg" CHECK (avg_cost >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_stock_nonneg" CHECK (stock >= 0);
ALTER TABLE "customers" ADD CONSTRAINT "customers_debt_nonneg" CHECK (debt >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_money_nonneg" CHECK (sale_total >= 0 AND amount_received >= 0 AND credit >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_parts_sum" CHECK (amount_received + credit = sale_total);
ALTER TABLE "sales" ADD CONSTRAINT "sales_paid_credit" CHECK (payment_kind <> 'paid' OR credit = 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_credit_received" CHECK (payment_kind <> 'credit' OR amount_received = 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_qty_pos" CHECK (qty > 0);
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_amount_pos" CHECK (amount > 0);
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_float_nonneg" CHECK (opening_float >= 0);
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_delta_nz" CHECK (delta <> 0);
ALTER TABLE "products" ADD CONSTRAINT "products_low_stock_nonneg" CHECK (low_stock_at >= 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_price_nonneg" CHECK (unit_price >= 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_cost_nonneg" CHECK (unit_cost >= 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_total" CHECK (line_total = unit_price * qty);
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_cost_nonneg" CHECK (unit_cost >= 0);
ALTER TABLE "initial_debts" ADD CONSTRAINT "initial_debts_amount_pos" CHECK (amount > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_pos" CHECK (amount > 0);



