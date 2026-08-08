import { IsString, IsEnum, IsNumber, IsPositive } from 'class-validator';
import { QuoteAsset } from '../interfaces/marketplace.interface';

export class QuoteTxDto {
  @IsString()
  @IsEnum(['USDC', 'XLM'])
  quoteAsset: QuoteAsset;

  @IsNumber()
  @IsPositive()
  amount: number;
}
