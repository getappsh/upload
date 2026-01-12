import { FileUploadEntity, FileUPloadStatusEnum, ReleaseArtifactEntity } from "@app/common/database/entities";
import { CreateFileUploadUrlDto, FileUploadUrlDto, UpdateFileUploadDto } from "@app/common/dto/upload";
import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThanOrEqual, Repository } from "typeorm";
import { MinioClientService } from "@app/common/AWS/minio-client.service";
import { TimeoutRepeatTask } from "@app/common/safe-cron/timeout-repeated-task.decorator";
import stream from 'stream';
import { EventEmitter } from 'eventemitter3';
import { FileProcessingService } from "@app/common/AWS/file-processing.service";


@Injectable()
export class FileUploadService {

  private static readonly OBJECT_PREFIX = 'upload/';
  private readonly logger = new Logger(FileUploadService.name);
  private readonly bucketName = this.configService.get('BUCKET_NAME');
  private emitter: EventEmitter = new EventEmitter();

  constructor(
    private readonly configService: ConfigService,
    private readonly minioClient: MinioClientService,
    private readonly fileProcessingService: FileProcessingService,
    @InjectRepository(FileUploadEntity) private readonly uploadRepo: Repository<FileUploadEntity>,
    @InjectRepository(ReleaseArtifactEntity) private readonly artifactRepo: Repository<ReleaseArtifactEntity>,
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

  async getFileUploadUrl(objectKey: string): Promise<FileUploadUrlDto> {
    this.logger.log(`Get file upload URL for objectKey: ${objectKey}`);
    const file = await this.getFileByObjectKey(objectKey);
    this.logger.verbose(`Get file upload URL for objectKey: ${objectKey}, file: ${JSON.stringify(file)}`);
    if (file.status === FileUPloadStatusEnum.UPLOADED) {
      throw new ForbiddenException(`File already uploaded: ${file.objectKey}`);
    }

    const url = await this.minioClient.generatePresignedUploadUrl(this.bucketName, file.objectKey);
    return new FileUploadUrlDto(file.id, url, file.objectKey);
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
    return this.uploadRepo.findOneBy({ id }).catch(err => { throw new NotFoundException(`File upload not found: ${id}, error: ${err}`) });
  }

  private getFileByObjectKey(objectKey: string): Promise<FileUploadEntity> {
    return this.uploadRepo.findOneBy({ objectKey: objectKey }).catch(err => {
      throw new Error(`File upload not found: ${objectKey}, error: ${err}`)
    });
  }

  async getFilesByIds(ids: number[]): Promise<FileUploadEntity[]> {
    return this.uploadRepo.findBy({ id: In(ids) }).catch(err => { throw new Error(`File upload not found: ${ids}, error: ${err}`) });
  }

  async areFilesUploaded(ids: number[]): Promise<boolean> {
    const uploaded = await this.uploadRepo.find({
      select: ['id'],
      where: { id: In(ids), status: FileUPloadStatusEnum.UPLOADED },
    })
      .catch(err => { throw new Error(`File upload not found: ${ids}, error: ${err}`) });

    return uploaded.length === ids.length
  }


  async onFileCreate(callback: (file: FileUploadEntity) => void) {
    this.emitter.on("fileCreated", callback);
  }

  async onFileDelete(callback: (file: FileUploadEntity) => void) {
    this.emitter.on("fileDeleted", callback);
  }

  createObjectKey(dto: CreateFileUploadUrlDto) {
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

      poller.on('notification', async record => {
        try {

          const eventName = record?.eventName;
          const objectKey = record?.s3?.object?.key;
          this.logger.log(`Received event: ${eventName}, for object: ${objectKey}`);

          if (eventName.startsWith('s3:ObjectCreated:')) {
            this.logger.debug(`Object created: ${JSON.stringify(record)}`);

            const file = new UpdateFileUploadDto();
            file.objectKey = objectKey;
            file.status = FileUPloadStatusEnum.UPLOADED;
            file.size = record?.s3?.object?.size;
            file.contentType = record?.s3?.object?.contentType;
            file.uploadAt = record?.eventTime;

            await this.updateUploadFile(file);


          } else if (eventName.startsWith('s3:ObjectRemoved:')) {
            this.logger.debug(`Object removed: ${JSON.stringify(record)}`);

            const file = new UpdateFileUploadDto();
            file.objectKey = objectKey;
            file.status = FileUPloadStatusEnum.REMOVED;

            await this.updateUploadFile(file);

          }
        } catch (error) {
          this.logger.error(`Error processing notification, error: ${error}`);
          poller.stop();
          reject(error);
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

  async updateUploadFile(file: UpdateFileUploadDto): Promise<number> {
    this.logger.log(`Updating file upload: ${file.objectKey}, status: ${file.status}`);

    if (!file.objectKey) {
      this.logger.warn(`File upload object key is required: ${JSON.stringify(file)}`);
      return 0;
    }

    // Process file for SHA256 and/or Cosign signature when uploaded
    // SHA256 is calculated by default for all uploaded files unless already present
    if (file.status === FileUPloadStatusEnum.UPLOADED) {
      const existingFile = await this.getFileByObjectKey(file.objectKey);
      const needsSha256 = !existingFile.sha256;
      const needsCosign = this.configService.get('COSIGN_DO_SIGN_FILES') === 'true';

      if (needsSha256 || needsCosign) {
        this.processAndSaveFile(file.objectKey, needsSha256, needsCosign).catch(err => {
          this.logger.error(`Error processing file: ${file.objectKey}, error: ${err}`);
        });
      }
    }

    const res = await this.uploadRepo.update({ objectKey: file.objectKey }, file);
    if (res.affected === 0) {
      this.logger.warn(`File upload not found: ${file.objectKey}`);
    } else {
      if (file.status === FileUPloadStatusEnum.UPLOADED) {
        this.emitter.emit("fileCreated", file)
      } else if (file.status === FileUPloadStatusEnum.REMOVED) {
        this.emitter.emit("fileDeleted", file)
      }
    }

    return res.affected
  }

  /**
   * Efficiently process file for SHA256 and/or Cosign signature using a single stream
   * @param objectKey - The object key
   * @param calculateSha256 - Whether to calculate SHA256
   * @param calculateCosign - Whether to calculate Cosign signature
   */
  private async processAndSaveFile(
    objectKey: string,
    calculateSha256: boolean,
    calculateCosign: boolean
  ): Promise<void> {
    this.logger.log(`Processing file: ${objectKey}, SHA256: ${calculateSha256}, Cosign: ${calculateCosign}`);
    
    try {
      const file = await this.getFileByObjectKey(objectKey);
      if (!file) {
        this.logger.warn(`File not found: ${objectKey}`);
        return;
      }

      // Get file stream from MinIO
      const fileStream = await this.minioClient.getObject(this.bucketName, objectKey);

      // Process file efficiently (stream is split internally if both operations are needed)
      // SHA256 is calculated by default unless explicitly set to false
      const result = await this.fileProcessingService.processFile(fileStream, {
        calculateSha256,
        calculateCosign,
      });

      // Update database with results
      const updateData: Partial<FileUploadEntity> = {};
      
      if (result.sha256) {
        updateData.sha256 = result.sha256;
        this.logger.log(`SHA256 calculated for ${objectKey}: ${result.sha256}`);
      }
      
      if (result.cosignSignature) {
        updateData.signature = result.cosignSignature.toString();
        this.logger.log(`File signed: ${objectKey}, signature: ${result.cosignSignature.toString()}`);
      }

      // Set progress to 100 since file was successfully uploaded and processed
      updateData.progress = 100;

      await this.uploadRepo.update({ id: file.id }, updateData);
      this.logger.debug(`File processing results saved to DB: ${objectKey}`);
      
      // Directly sync SHA256 to release_artifact table if calculated
      if (result.sha256) {
        try {
          await this.artifactRepo.update(
            { fileUpload: { id: file.id } },
            { sha256: result.sha256 }
          );
          this.logger.debug(`SHA256 synced to release_artifact for fileUpload ID: ${file.id}`);
        } catch (error) {
          this.logger.warn(`Failed to sync SHA256 to release_artifact for fileUpload ID: ${file.id}: ${error.message}`);
        }
      }
      
      // Emit fileCreated event again to sync sha256 and other updates to related tables
      if (result.sha256) {
        const updatedFile = await this.getFileByObjectKey(objectKey);
        this.emitter.emit("fileCreated", updatedFile);
        this.logger.debug(`Emitted fileCreated event for sha256 sync: ${objectKey}`);
      }
    } catch (error) {
      this.logger.error(`Error processing file: ${objectKey}, error: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate SHA256 hash from a file in the bucket
   * @param bucketName - The bucket name
   * @param objectKey - The object key
   * @returns The SHA256 hash as a hex string
   */
  async calculateSha256FromBucket(bucketName: string, objectKey: string): Promise<string> {
    this.logger.log(`Calculating SHA256 for ${bucketName}/${objectKey}`);
    const fileStream = await this.minioClient.getObject(bucketName, objectKey);
    // Explicitly calculate only SHA256 (default behavior, but being explicit for clarity)
    const result = await this.fileProcessingService.processFile(fileStream, {
      calculateCosign: false,
    });
    return result.sha256!;
  }



  // TODO sync deleted files
  private async syncDB() {
    this.logger.log('Syncing DB with Minio');
    await this.syncUploadedFiles();

    this.logger.log('DB Sync finished');
  }



  private async syncUploadedFiles() {
    this.logger.log('Syncing uploaded files');

    const now = new Date();
    const batchSize = 10;
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

          let dto = new UpdateFileUploadDto();
          dto.objectKey = file.objectKey;
          dto.status = FileUPloadStatusEnum.UPLOADED;
          dto.size = stats.size;
          dto.contentType = stats?.metaData?.['content-type'];
          dto.uploadAt = stats.lastModified;
          return dto;

        }).filter(file => file !== null);

        if (filesToUpdate.length > 0) {
          this.logger.debug(`Updating files: ${filesToUpdate.map(file => file.objectKey)}`);
          Promise.all(filesToUpdate.map(file => this.updateUploadFile(file))).catch(err => {
            this.logger.error(`Error updating files: ${err}`)
          });

        }
      }

      skip += batchSize;
    } while (files.length === batchSize);
  }

  @TimeoutRepeatTask({ name: "listen-to-minio-events", initialTimeout: 1000, repeatTimeout: 60000 }) // Start after 1 second, repeat when finished every 60 seconds
  async listenTomMinioEvents() {
    if (process.env.MINIO_EVENTS_SKIP === 'true') {
      this.logger.verbose('Minio events listener skipped');
      return;
    }
    this.syncDB();
    return this.listenToObjectsEvents().catch(() => { });
  }

}