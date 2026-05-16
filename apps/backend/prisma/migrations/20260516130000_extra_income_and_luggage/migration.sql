-- ==========================================================================
-- Migration: ExtraIncome + LuggageTicket (servicios accesorios)
-- ==========================================================================
--
-- Agrega DOS entidades nuevas para registrar ingresos no operacionales:
--   1. ExtraIncome → uso del baño (precios diferenciados M/F forzados
--      por backend, sin lifecycle, sin ficha física).
--   2. LuggageTicket → guardado de maletas con ficha numerada física,
--      lifecycle (active → delivered | incident), búsqueda por cliente.
--
-- NO toca:
--   - Product, Consumption, TableSession, Order — el ledger del bar
--     queda intacto.
--   - Ningún índice o constraint existente.
--
-- Constraint clave: una ficha de maleta NO puede estar activa dos veces
-- al mismo tiempo. Lo enforce un partial unique index sobre
-- (ticket_number) WHERE status='active'. Cuando la maleta se entrega o
-- reporta incidente, status cambia y el índice deja de aplicarle a esa
-- fila — la ficha queda libre para un registro nuevo.
--
-- Safe + reversible: las dos tablas + sus enums se pueden droppear en
-- una migración de rollback sin afectar nada más.

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "ExtraIncomeType" AS ENUM ('restroom');
CREATE TYPE "ExtraIncomeStatus" AS ENUM ('active', 'reversed');
CREATE TYPE "LuggageStatus" AS ENUM ('active', 'delivered', 'incident');
CREATE TYPE "LuggagePaymentStatus" AS ENUM ('pending', 'paid');

-- ─── ExtraIncome ──────────────────────────────────────────────────────────

CREATE TABLE "ExtraIncome" (
  "id"             SERIAL PRIMARY KEY,
  "type"           "ExtraIncomeType"   NOT NULL,
  "subtype"        TEXT,
  "amount"         DECIMAL(10, 2)      NOT NULL,
  "quantity"       INTEGER             NOT NULL DEFAULT 1,
  "total_amount"   DECIMAL(10, 2)      NOT NULL,
  "status"         "ExtraIncomeStatus" NOT NULL DEFAULT 'active',
  "notes"          TEXT,
  "created_by"     TEXT,
  "created_at"     TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversed_by"    TEXT,
  "reversed_at"    TIMESTAMP(3),
  "reverse_reason" TEXT
);

CREATE INDEX "ExtraIncome_type_status_created_at_idx"
  ON "ExtraIncome" ("type", "status", "created_at");
CREATE INDEX "ExtraIncome_created_at_idx"
  ON "ExtraIncome" ("created_at");

-- ─── LuggageTicket ────────────────────────────────────────────────────────

CREATE TABLE "LuggageTicket" (
  "id"                   SERIAL PRIMARY KEY,
  "ticket_number"        INTEGER                 NOT NULL,
  "customer_first_name"  TEXT                    NOT NULL,
  "customer_last_name"   TEXT                    NOT NULL,
  "customer_phone"       TEXT                    NOT NULL,
  "amount"               DECIMAL(10, 2)          NOT NULL,
  "payment_status"       "LuggagePaymentStatus"  NOT NULL DEFAULT 'pending',
  "status"               "LuggageStatus"         NOT NULL DEFAULT 'active',
  "notes"                TEXT,
  "created_by"           TEXT,
  "created_at"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_by"         TEXT,
  "delivered_at"         TIMESTAMP(3),
  "incident_reason"      TEXT,
  "incident_at"          TIMESTAMP(3),
  "incident_by"          TEXT
);

CREATE INDEX "LuggageTicket_status_created_at_idx"
  ON "LuggageTicket" ("status", "created_at");
CREATE INDEX "LuggageTicket_ticket_number_status_idx"
  ON "LuggageTicket" ("ticket_number", "status");
CREATE INDEX "LuggageTicket_customer_phone_idx"
  ON "LuggageTicket" ("customer_phone");

-- Partial unique index: una ficha no puede estar `active` dos veces.
-- Cuando una maleta pasa a `delivered` o `incident`, la fila deja de
-- estar bajo este índice y la ficha queda libre para un registro nuevo.
CREATE UNIQUE INDEX "LuggageTicket_ticket_number_active_uniq"
  ON "LuggageTicket" ("ticket_number")
  WHERE "status" = 'active';
