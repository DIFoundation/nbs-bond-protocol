import { IsEnum, IsOptional } from 'class-validator';

export class QuoteBalanceQueryDto {
  @IsOptional()
  @IsEnum(['USDC', 'XLM'])
  asset?: 'USDC' | 'XLM';
}
