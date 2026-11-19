import { IsString, Matches } from "class-validator";

export class CreatePaymentOrderDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  payableReference!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,128}$/)
  idempotencyKey!: string;
}
