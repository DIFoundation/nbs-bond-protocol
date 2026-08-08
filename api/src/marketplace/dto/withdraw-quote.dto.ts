import { IsEnum, IsNumber, IsPositive, IsOptional } from 'class-validator';

export class WithdrawQuoteDto {
  @IsEnum(['USDC', 'XLM'])
  asset: 'USDC' | 'XLM';

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsNumber()
  @IsOptional()
  nonce?: number;
}
