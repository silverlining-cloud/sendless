import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BlobStore, UploadedPart } from '../ports.js';

export class S3BlobStore implements BlobStore {
  private readonly s3: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
  ) {
    // Browsers upload with plain PUTs; don't let the SDK put checksum requirements into presigned URLs.
    this.s3 = new S3Client({
      region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createMultipartUpload(key: string, contentType: string) {
    const result = await this.s3.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!result.UploadId) throw new Error('S3 returned no UploadId');
    return result.UploadId;
  }

  presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSeconds: number) {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: expiresInSeconds },
    );
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }

  async size(key: string) {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
      throw error;
    }
  }

  presignDownload(key: string, opts: { contentDisposition: string; contentType: string; expiresInSeconds: number }) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: opts.contentDisposition,
        ResponseContentType: opts.contentType,
      }),
      { expiresIn: opts.expiresInSeconds },
    );
  }

  async deleteObjects(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      if (chunk.length === 0) continue;
      const result = await this.s3.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }),
      );
      if (result.Errors?.length) throw new Error(`Failed to delete ${result.Errors.length} objects: ${result.Errors[0]?.Message}`);
    }
  }
}
