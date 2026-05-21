import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  IsNumber,
} from 'class-validator';

export class CreateListingDto {
  @ApiProperty()
  @IsString()
  @Length(3, 140)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(10, 8000)
  description!: string;

  @ApiProperty({ description: 'Price in minor units (cents)' })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiProperty({ default: 'EUR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  inventory!: number;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  locationCountry?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;
}

export class UpdateListingDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 140)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(10, 8000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  inventory?: number;
}

export class PhotoUploadDto {
  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  contentType!: string;
}
