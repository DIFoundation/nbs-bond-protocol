import { IsString } from 'class-validator';
import { IsStellarAddress } from '../../common/decorators/is-stellar-address.decorator';

export class ClaimCreditsDto {
  @IsString()
  @IsStellarAddress()
  investorAddress: string;
}
