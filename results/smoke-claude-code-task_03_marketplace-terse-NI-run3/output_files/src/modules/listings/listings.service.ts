import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SellersService } from '../sellers/sellers.service';
import { StorageService } from '../storage/storage.service';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto';

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellers: SellersService,
    private readonly storage: StorageService,
  ) {}

  /** Resolves the seller profile and asserts the caller owns the listing. */
  private async ownedListing(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { seller: true },
    });
    if (!listing || listing.deletedAt) throw new NotFoundException('Listing not found');
    if (listing.seller.userId !== userId) throw new ForbiddenException('Not your listing');
    return listing;
  }

  async create(userId: string, dto: CreateListingDto) {
    // Enforces KYC / DSA trader verification.
    const sellerId = await this.sellers.assertCanList(userId);

    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new BadRequestException('Unknown category');

    return this.prisma.listing.create({
      data: {
        sellerId,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        currency: dto.currency ?? 'EUR',
        inventory: dto.inventory,
        locationCity: dto.locationCity,
        locationCountry: dto.locationCountry,
        latitude: dto.latitude,
        longitude: dto.longitude,
        status: 'DRAFT',
      },
    });
  }

  async update(userId: string, listingId: string, dto: UpdateListingDto) {
    await this.ownedListing(userId, listingId);
    return this.prisma.listing.update({ where: { id: listingId }, data: dto });
  }

  /** Publishes a draft. Requires at least one photo. */
  async publish(userId: string, listingId: string) {
    const listing = await this.ownedListing(userId, listingId);
    const photoCount = await this.prisma.listingPhoto.count({ where: { listingId } });
    if (photoCount === 0) throw new BadRequestException('Add at least one photo before publishing');

    const status = listing.inventory > 0 ? 'ACTIVE' : 'OUT_OF_STOCK';
    return this.prisma.listing.update({ where: { id: listingId }, data: { status } });
  }

  async pause(userId: string, listingId: string) {
    await this.ownedListing(userId, listingId);
    return this.prisma.listing.update({ where: { id: listingId }, data: { status: 'PAUSED' } });
  }

  /** Soft-delete — listing kept for order history / audit. */
  async remove(userId: string, listingId: string) {
    await this.ownedListing(userId, listingId);
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: 'REMOVED', deletedAt: new Date() },
    });
  }

  async getById(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        photos: { orderBy: { position: 'asc' } },
        category: true,
        seller: { select: { id: true, businessName: true, ratingAvg: true, ratingCount: true } },
      },
    });
    if (!listing || listing.deletedAt) throw new NotFoundException('Listing not found');
    return listing;
  }

  async listForSeller(userId: string) {
    const profile = await this.sellers.getMyProfile(userId);
    return this.prisma.listing.findMany({
      where: { sellerId: profile.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Presigned URL for a direct-to-S3 photo upload. */
  async createPhotoUploadUrl(userId: string, listingId: string, contentType: string) {
    await this.ownedListing(userId, listingId);
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Only image uploads are allowed');
    }
    return this.storage.createUploadUrl(listingId, contentType);
  }

  /** Records a photo after the client confirms a successful S3 upload. */
  async attachPhoto(userId: string, listingId: string, key: string) {
    await this.ownedListing(userId, listingId);
    const position = await this.prisma.listingPhoto.count({ where: { listingId } });
    return this.prisma.listingPhoto.create({ data: { listingId, s3Key: key, position } });
  }
}
