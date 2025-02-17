import { FileUploadEntity, FileUPloadStatusEnum } from "@app/common/database/entities";
import { CreateFileUploadUrlDto, FileUploadUrlDto } from "@app/common/dto/upload";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThanOrEqual, Repository } from "typeorm";
import { MinioClientService } from "@app/common/AWS/minio-client.service";
import { TimeoutRepeatTask } from "@app/common/safe-cron/timeout-repeated-task.decorator";
import stream from 'stream';
import {EventEmitter} from 'eventemitter3';


@Injectable()
export class FileUploadService{

  private static readonly OBJECT_PREFIX = 'upload/';
  private readonly logger = new Logger(FileUploadService.name);
  private readonly bucketName = this.configService.get('BUCKET_NAME');
  private emitter: EventEmitter = new EventEmitter();

  constructor(
    private readonly configService: ConfigService,
    private readonly minioClient: MinioClientService,
    @InjectRepository(FileUploadEntity) private readonly uploadRepo: Repository<FileUploadEntity>,
  ) { }


  async createFileUploadUrl(dto: CreateFileUploadUrlDto) {
    this.logger.log(`generatePreSingedUrl: ${JSON.stringify(dto)}`);
    let objectKey = this.createObjectKey(dto);

    const upload = new FileUploadEntity();
    upload.userId = dto.userId;
    upload.fileName = dto.fileName;
    upload.objectKey = objectKey;
    upload.bucketName = this.bucketName
    
    
    const signedUrl = await this.minioClient.generatePresignedUploadUrl(this.bucketName, objectKey);

    this.logger.log(`generatePreSingedUrl: ${JSON.stringify(signedUrl)}`);

    try {
      const res = await this.uploadRepo.upsert(upload, ['objectKey']);
      const id = res.identifiers[0].id
     
      return new FileUploadUrlDto(id, signedUrl, objectKey);
    } catch (error) {
      this.logger.error(`Error saving file upload, ${error}`);
      throw error;
    }

  }

  async getFileDownloadUrl(id: number): Promise<string> {
    const file = await this.getFileById(id);
    return this.minioClient.generatePresignedDownloadUrl(this.bucketName, file.objectKey);
  }


  async getFileStream(id: number): Promise<stream.Readable> {
    const file = await this.getFileById(id);
    return this.minioClient.getObject(this.bucketName, file.objectKey);
  }


  private getFileById(id: number): Promise<FileUploadEntity> {
    return this.uploadRepo.findOneBy({id}).catch(err => {throw new Error(`File upload not found: ${id}, error: ${err}`)});
  }


  async getFilesByIds(ids: number[]): Promise<FileUploadEntity[]> {
    return this.uploadRepo.findBy({ id: In(ids) }).catch(err => {throw new Error(`File upload not found: ${ids}, error: ${err}`)});
  }

  async onFileCreate(callback: (file: FileUploadEntity) => void) {
    this.emitter.on("fileCreated", callback);
  }

  async onFileDelete(callback: (file: FileUploadEntity) => void) {
    this.emitter.on("fileDeleted", callback);
  }
  
  private createObjectKey(dto: CreateFileUploadUrlDto) {
    if (dto.objectKey) {
      const suffix = dto.objectKey.endsWith('/') ? '' : '/';
      return `${FileUploadService.OBJECT_PREFIX}${dto.userId}/${dto.objectKey}${suffix}${dto.fileName}`;
    }
  
    const sanitizedFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_'); 
    return `${FileUploadService.OBJECT_PREFIX}${dto.userId}/${sanitizedFileName}`;
  }

  private async listenToObjectsEvents(): Promise<void> {
    return new Promise((resolve, reject) => {

      this.logger.log(`Listening to objects events in bucket: ${this.bucketName}`);
      const poller = this.minioClient.listenBucketNotifications(this.bucketName, FileUploadService.OBJECT_PREFIX, '', ['s3:ObjectCreated:*', 's3:ObjectRemoved:*']);

      poller.on('notification', record => {
        const eventName = record?.eventName;
        const objectKey = record?.s3?.object?.key;
        this.logger.log(`Received event: ${eventName}, for object: ${objectKey}`);

        if (eventName.startsWith('s3:ObjectCreated:')) {
          this.logger.debug(`Object created: ${JSON.stringify(record)}`);

          const file = new FileUploadEntity();
          file.objectKey = objectKey;
          file.size = record?.s3?.object?.size;
          file.contentType = record?.s3?.object?.contentType;
          file.uploadAt = record?.eventTime;
          file.status = FileUPloadStatusEnum.UPLOADED;

          this.updateUploadFile(file).then(effected => {
            if (effected > 0) this.emitter.emit("fileCreated", file)
          });
          

        }else if (eventName.startsWith('s3:ObjectRemoved:')) {
          this.logger.debug(`Object removed: ${JSON.stringify(record)}`);
          const file = new FileUploadEntity();
          file.objectKey = objectKey;
          file.status = FileUPloadStatusEnum.REMOVED;
          this.updateUploadFile(file).then(effected => {
            if (effected > 0) this.emitter.emit("fileDeleted", file)
          });

        }
      })

      poller.on('error', error => {
        this.logger.error(`Error listening to bucket notifications: ${error}`);
        poller.stop();
        reject(error);
      });
    });

  }

  async removeFile(id: number) {
    this.logger.debug(`Deleting file with id: ${id}`);

    const file = await this.uploadRepo.findOneBy({ id });
    if (!file) {
      this.logger.warn(`File not found: ${id}`); 
      return;
    }

    if (file.status === FileUPloadStatusEnum.UPLOADED) {      
      await this.minioClient.deleteObjects(this.bucketName, file.objectKey);
    }
  
    this.logger.debug(`Remove file: ${file.objectKey}`);
    await this.uploadRepo.update({ id }, { status: FileUPloadStatusEnum.REMOVED });
  }

  async deleteItemRow(id: number) {
    this.logger.debug(`Deleting item row with id: ${id}`);
    await this.uploadRepo.delete({ id });
  }
  
  async updateUploadFile(file: FileUploadEntity): Promise<number> {
    this.logger.log(`Updating file upload: ${file.objectKey}, status: ${file.status}`);
    const res = await this.uploadRepo.update({ objectKey: file.objectKey }, file);
    if (res.affected === 0){
      this.logger.warn(`File upload not found: ${file.objectKey}`);
    } 

    return res.affected
  }


  // TODO sync deleted files
  private async syncDB(){
    this.logger.log('Syncing DB with Minio');
    await this.syncUploadedFiles();

    this.logger.log('DB Sync finished');
  }

  

  private async syncUploadedFiles() {
    this.logger.log('Syncing uploaded files');

    const now = new Date();
    const batchSize = 100;
    let skip = 0;
    let files;

    do {
      this.logger.log(`Getting pending files, batch starting at ${skip}`);
      files = await this.uploadRepo.find({
        select: ['objectKey', 'id'],
        where: {
          status: FileUPloadStatusEnum.PENDING,
          createdDate: LessThanOrEqual(now)
        },
        order: {
          createdDate: 'DESC'
        },
        take: batchSize,
        skip: skip
      });

      if (files.length === 0) {
        this.logger.log('No more pending files to process');
        break;
      }

      this.logger.log(`Processing ${files.length} files`);
      const processingBatchSize = 5;

      for (let i = 0; i < files.length; i += processingBatchSize) {
        this.logger.debug(`Processing batch: ${i} - ${Math.min(i + processingBatchSize, files.length)}`);
        const batch = files.slice(i, i + processingBatchSize);

        const filesStats = await Promise.all(
          batch.map(file => this.minioClient.getObjectStat(this.bucketName, file.objectKey)
            .catch(err => {
              this.logger.error(`Error getting object stat: ${file.objectKey}, ${err}`);
              return undefined;
            })
        ));

        const filesToUpdate = batch.map((file, index) => {
          const stats = filesStats[index];
          if (!stats) return null;

          return {
            id: file.id,
            objectKey: file.objectKey,
            size: stats?.size,
            contentType: stats?.metaData?.['content-type'],
            uploadAt: stats?.lastModified,
            status: FileUPloadStatusEnum.UPLOADED
          };

        }).filter(file => file !== null);

        if (filesToUpdate.length > 0) {
          this.logger.debug(`Updating files: ${filesToUpdate.map(file => file.objectKey)}`);
          await this.uploadRepo.save(filesToUpdate).catch(err => {
            this.logger.error(`Error updating files: ${err}`);
          });
        }
      }

      skip += batchSize;
    } while (files.length === batchSize);
  }

  @TimeoutRepeatTask({ name: "listen-to-minio-events", initialTimeout: 1000, repeatTimeout: 10000 }) // Start after 1 second, repeat when finished every 10 seconds
  async listenTomMinioEvents() {
    this.syncDB();
    return this.listenToObjectsEvents();
  }
  
}