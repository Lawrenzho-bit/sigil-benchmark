import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsString, Length, ValidateNested, IsOptional } from 'class-validator';

export class ShippingAddressDto {
  @ApiProperty()
  @IsString()
  line1!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  line2?: string;

  @ApiProperty()
  @IsString()
  city!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiProperty()
  @IsString()
  @Length(2, 2)
  country!: string;
}

export class CheckoutDto {
  @ApiProperty({ type: ShippingAddressDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  @ApiProperty({ description: 'ISO country used for VAT/GST determination' })
  @IsString()
  @Length(2, 2)
  billingCountry!: string;
}
