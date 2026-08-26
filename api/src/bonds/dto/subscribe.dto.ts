import { IsNumber, IsPositive, IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { IsStellarAddress } from '../../common/decorators/is-stellar-address.decorator';

export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsOptional()
  @IsNumber()
  nonce?: number;

  @IsString()
  @IsStellarAddress()
  investorAddress: string;
}
