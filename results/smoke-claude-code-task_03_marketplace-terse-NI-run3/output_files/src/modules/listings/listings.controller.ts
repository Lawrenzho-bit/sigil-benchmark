import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateListingDto, UpdateListingDto, PhotoUploadDto } from './dto/listing.dto';

@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  /** Public listing detail. */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.listings.getById(id);
  }

  // --- Seller-only management ---
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  mine(@CurrentUser() user: AuthUser) {
    return this.listings.listForSeller(user.id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) {
    return this.listings.create(user.id, dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateListingDto) {
    return this.listings.update(user.id, id, dto);
  }

  @Post(':id/publish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.publish(user.id, id);
  }

  @Post(':id/pause')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.pause(user.id, id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.remove(user.id, id);
  }

  /** Step 1: get a presigned URL; client PUTs the image bytes to S3. */
  @Post(':id/photos/upload-url')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  uploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PhotoUploadDto,
  ) {
    return this.listings.createPhotoUploadUrl(user.id, id, dto.contentType);
  }

  /** Step 2: confirm the upload and attach the photo to the listing. */
  @Post(':id/photos')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  attachPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('key') key: string,
  ) {
    return this.listings.attachPhoto(user.id, id, key);
  }
}
