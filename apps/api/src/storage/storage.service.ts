import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Thin wrapper over one S3-compatible client (MinIO in dev). Presigned GET URLs
 * are built against S3_PUBLIC_ENDPOINT so a browser can follow them; everything
 * else uses the in-cluster S3_ENDPOINT.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  readonly bucket = process.env.S3_BUCKET ?? 'oudhealth-dev';

  private readonly client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  });

  private readonly publicClient = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  });

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const msg =
        `Object storage bucket "${this.bucket}" is not reachable at ${process.env.S3_ENDPOINT}. ` +
        'Run `docker compose up -d minio minio-setup`, or fix the S3_* configuration.';
      // Fail fast in production: a running API that cannot store uploads is not
      // healthy. In dev, warn and let the process come up.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg + ` (${(err as Error)?.message ?? err})`);
      }
      this.log.warn(msg);
    }
  }

  /** Readiness check: can we actually reach the bucket right now? */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /**
   * A short-lived presigned GET URL a browser can follow directly. Only raster
   * images render inline; every other type (PDF, and anything that could carry
   * active content such as SVG or HTML) is forced to `attachment` so
   * user-uploaded content is never rendered in a document context.
   * `ResponseContentType` is pinned to the type we recorded, independent of how
   * the object was stored.
   */
  async presignGet(
    key: string,
    opts: { downloadName?: string; mimeType?: string; ttlSeconds?: number } = {},
  ) {
    const { downloadName, mimeType, ttlSeconds = 300 } = opts;
    const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    const inline = !!mimeType && INLINE_TYPES.has(mimeType);
    const filename = downloadName ? `; filename="${downloadName.replace(/["\r\n]/g, '')}"` : '';
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}${filename}`,
        ...(mimeType ? { ResponseContentType: mimeType } : {}),
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Does the object exist? (used by the orphan sweeper) */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Every object under a prefix, as { key, lastModified }. Paginates. */
  async list(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
    const out: { key: string; lastModified: Date }[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}
