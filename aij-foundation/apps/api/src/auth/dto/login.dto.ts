// Directed source adaptation: provenance section 13; bounded bcrypt input.
import { IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}
