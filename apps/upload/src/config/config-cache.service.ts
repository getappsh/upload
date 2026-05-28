import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioClientService } from '@app/common/AWS/minio-client.service';

/**
 * Caches the final assembled device config in S3 / MinIO, keyed by the
 * revision's semantic version string.
 *
 * Cache key format: `config-cache/{deviceId}/{semver}.json`
 */
@Injectable()
export class ConfigCacheService {
  private readonly logger = new Logger(ConfigCacheService.name);
  private readonly bucketName = this.configService.get('BUCKET_NAME');

  constructor(
    private readonly configService: ConfigService,
    private readonly minioClient: MinioClientService,
  ) {}

  async getByVersion(deviceId: string, semver: string): Promise<Record<string, any> | null> {
    const key = this.versionedObjectKey(deviceId, semver);
    try {
      const stream = await this.minioClient.getObject(this.bucketName, key);
      const body = await this.streamToString(stream);
      this.logger.debug(`Config cache hit for device ${deviceId} @ ${semver}`);
      return JSON.parse(body);
    } catch (err: any) {
      if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') return null;
      this.logger.warn(`Config cache get failed for device ${deviceId} @ ${semver}: ${err.message}`);
      return null;
    }
  }

  async setByVersion(deviceId: string, semver: string, payload: Record<string, any>): Promise<void> {
    const key = this.versionedObjectKey(deviceId, semver);
    try {
      const content = JSON.stringify(payload);
      await this.minioClient['client'].putObject(
        this.bucketName,
        key,
        Buffer.from(content),
        content.length,
        { 'Content-Type': 'application/json' },
      );
      this.logger.debug(`Config cache stored for device ${deviceId} @ ${semver}`);
    } catch (err: any) {
      this.logger.warn(`Config cache set failed for device ${deviceId} @ ${semver}: ${err.message}`);
    }
  }

  private versionedObjectKey(deviceId: string, semver: string): string {
    return `config-cache/${deviceId}/${semver}.json`;
  }

  private streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });
  }
}
