import { IsNumber, IsPositive, IsString, IsNotEmpty } from 'class-validator';
import { IsStellarAddress } from '../../common/decorators/is-stellar-address.decorator';

export class TransferBondDto {
  @IsString()
  @IsStellarAddress()
  fromAddress: string;

  @IsString()
  @IsStellarAddress()
  toAddress: string;

  @IsString()
  @IsNotEmpty()
  amount: string;
}
