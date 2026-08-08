import { IsEnum, IsNumber, IsPositive, IsOptional } from 'class-validator';

export class DepositQuoteDto {
  @IsEnum(['USDC', 'XLM'])
  asset: 'USDC' | 'XLM';

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsNumber()
  @IsOptional()
  nonce?: number;
}
