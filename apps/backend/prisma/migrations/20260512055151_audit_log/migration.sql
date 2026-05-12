-- CreateEnum
CREATE TYPE "AuditEventKind" AS ENUM ('login_success', 'login_failed', 'login_locked', 'password_reset_requested', 'password_reset_completed', 'access_code_rotated', 'session_opened_by_admin', 'session_marked_paid', 'session_closed', 'session_voided', 'session_partial_payment', 'walkin_account_opened', 'product_created', 'product_updated', 'product_activated', 'product_deactivated', 'inventory_movement', 'bill_adjustment');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "kind" "AuditEventKind" NOT NULL,
    "actor_id" INTEGER,
    "actor_label" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "AuditLog_kind_created_at_idx" ON "AuditLog"("kind", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_created_at_idx" ON "AuditLog"("actor_id", "created_at");
