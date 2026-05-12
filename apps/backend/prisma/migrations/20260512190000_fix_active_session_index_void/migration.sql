-- Fix: el índice parcial que garantiza "una sola sesión activa por mesa"
-- fue creado considerando solo el estado `closed` como inactivo. Cuando
-- se agregó el estado `void` en la migración 20260512053301 quedó dentro
-- del índice, así que una mesa que tuvo una sesión anulada no podía
-- abrir otra (UNIQUE violation en table_id).
--
-- Recreamos el índice incluyendo `void` como "fuera del activo": una
-- sesión anulada está cerrada para siempre y no debería bloquear la
-- apertura de una nueva.

DROP INDEX IF EXISTS "TableSession_one_active_per_table";

CREATE UNIQUE INDEX "TableSession_one_active_per_table"
ON "TableSession" ("table_id")
WHERE "status" NOT IN ('closed', 'void');
