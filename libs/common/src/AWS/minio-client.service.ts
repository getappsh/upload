import { Injectable, OnApplicationBootstrap, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Minio from 'minio';
import stream from 'stream';


@Injectable()
export class MinioClientService implements OnApplicationBootstrap{

  private readonly logger = new Logger(MinioClientService.name);
  private readonly client: Minio.Client;

  private readonly uploadUrlExpire = Number(this.configService.get<number>('UPLOAD_URL_EXPIRE'))
  private readonly downloadUrlExpire = Number(this.configService.get<number>('DOWNLOAD_URL_EXPIRE'))

  constructor(private configService: ConfigService){
    let endpoint = this.configService.get('S3_ENDPOINT_INTERNAL').replace(/^https?:\/\//, '');
    const accessKey = this.configService.get('ACCESS_KEY_ID');
    const secretKey = this.configService.get('SECRET_ACCESS_KEY');
    const useSSL = this.configService.get('MINIO_USE_SSL') === 'true';
   
    this.client = new Minio.Client({
      endPoint: endpoint,
      accessKey: accessKey,
      secretKey: secretKey,
      useSSL: useSSL
    })

  }
 
  listenBucketNotifications(bucketName: string, prefix: string = '', subfix: string = '', events: string[] = []): Minio.NotificationPoller {
    return this.client.listenBucketNotification(bucketName, prefix, subfix,  events);
  }

  generatePresignedUploadUrl(bucketName: string, objectKey: string, expression?: number): Promise<string> {
    return this.client.presignedPutObject(bucketName, objectKey, expression || this.uploadUrlExpire);
  }


  generatePresignedDownloadUrl(bucketName: string, objectKey: string, expression?: number): Promise<string> {
    return this.client.presignedGetObject(bucketName, objectKey, expression || this.downloadUrlExpire);
  }

  getObject(bucketName: string, objectKey: string): Promise<stream.Readable> {
    return this.client.getObject(bucketName, objectKey);
    
  }
  
  async getObjectStat(bucketName: string, objectKey: string): Promise<Minio.BucketItemStat | undefined> {
    try {
      return await this.client.statObject(bucketName, objectKey);
    } catch (err) {
      if (err.code === 'AccessDenied' || err.code === 'NotFound') {
        return undefined;
      } else {
        return Promise.reject(err);
      }
    }
  }

  bucketExists(bucketName: string): Promise<boolean>{
    return this.client.bucketExists(bucketName)
  }

  async onApplicationBootstrap() {
    const bucketName = this.configService.get('BUCKET_NAME');
    const exists = await this.bucketExists(bucketName);
    this.logger.debug(`Bucket "${bucketName}" exists: ${exists}`)
  }
}