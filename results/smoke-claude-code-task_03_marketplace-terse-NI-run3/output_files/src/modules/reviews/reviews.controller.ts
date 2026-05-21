import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min, Length } from 'class-validator';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class CreateReviewDto {
  @ApiProperty()
  @IsString()
  orderId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  comment?: string;
}

class ReplyDto {
  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  reply!: string;
}

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('seller/:sellerId')
  forSeller(@Param('sellerId') sellerId: string) {
    return this.reviews.listForSeller(sellerId);
  }

  @Get('listing/:listingId')
  forListing(@Param('listingId') listingId: string) {
    return this.reviews.listForListing(listingId);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReviewDto) {
    return this.reviews.createReview(user.id, dto.orderId, dto.rating, dto.comment);
  }

  @Post(':id/reply')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.reviews.addSellerReply(user.id, id, dto.reply);
  }
}
