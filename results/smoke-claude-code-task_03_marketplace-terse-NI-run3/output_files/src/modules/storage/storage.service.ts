import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * S3-compatible object storage for listing photos. Uploads use presigned PUT
 * URLs so large image bytes go client -> bucket directly, never through the API.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET')!;
    this.publicUrl = this.config.get<string>('S3_PUBLIC_URL')!;
    this.s3 = new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION'),
      forcePathStyle: this.config.get<boolean>('S3_FORCE_PATH_STYLE', true),
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY')!,
      },
    });
  }

  /**
   * Issues a presigned upload URL for a new listing photo.
   * @returns the object key (store on ListingPhoto) and the upload URL.
   */
  async createUploadUrl(
    listingId: string,
    contentType: string,
  ): Promise<{ key: string; uploadUrl: string; publicUrl: string }> {
    const ext = contentType.split('/')[1] ?? 'jpg';
    const key = `listings/${listingId}/${randomUUID()}.${ext}`;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: 900 },
    );
    return { key, uploadUrl, publicUrl: this.publicUrlFor(key) };
  }

  publicUrlFor(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
