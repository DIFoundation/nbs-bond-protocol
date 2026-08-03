import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class ChallengeDto {
  @IsString()
  @IsNotEmpty()
  counterEvidenceHash: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsNumber()
  @IsOptional()
  nonce?: number;
}
