import { IsNumber, IsPositive, IsString, IsOptional } from 'class-validator';
import { IsStellarAddress } from '../../common/decorators/is-stellar-address.decorator';

export class SubscribeDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsNumber()
  nonce?: number;

  @IsString()
  @IsStellarAddress()
  investorAddress: string;
}
