import { IsNumber, IsPositive } from 'class-validator';

export class DistributeCouponDto {
  @IsNumber()
  @IsPositive()
  periodIndex: number;

  @IsNumber()
  @IsPositive()
  reportId: number;
}
