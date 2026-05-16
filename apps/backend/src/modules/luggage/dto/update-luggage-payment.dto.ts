import { IsIn } from "class-validator";

/**
 * Cambiar el estado de pago de una maleta (típico: pending → paid).
 * El monto es fijo, no se toca; solo se marca cuando el cliente paga
 * al ingresar o al retirar.
 */
export class UpdateLuggagePaymentDto {
  @IsIn(["pending", "paid"])
  payment_status!: "pending" | "paid";
}
