import { IsIn } from 'class-validator';

export class CheckoutDto {
  @IsIn(['MONTHLY', 'ANNUAL'])
  billingCycle: 'MONTHLY' | 'ANNUAL';
}
