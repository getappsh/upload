import { UploadTopics, UploadTopicsEmit } from '@app/common/microservice-client/topics';
import { Inject, Injectable, Logger, OnModuleInit, Param, Req, Res, UploadedFile } from '@nestjs/common';
import { lastValueFrom, Observable } from 'rxjs';
import { UploadArtifactDto, UpdateUploadStatusDto, UploadManifestDto, FileUploadUrlDto, UpdateFileUploadDto, UpdateFileDto } from '@app/common/dto/upload';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { PassThrough } from 'stream';
import { Request, Response } from 'express';
import axios, { AxiosResponse } from 'axios';
import { FileUPloadStatusEnum } from '@app/common/database/entities';


@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  constructor(
    @Inject(MicroserviceName.UPLOAD_SERVICE) private uploadClient: MicroserviceClient){}

  uploadArtifact(data: UploadArtifactDto): Observable<{}> {
    this.logger.log("Upload Artifact")
    return this.uploadClient.send(
            UploadTopics.UPLOAD_ARTIFACT,
            data
        )
  }

  uploadManifest(@UploadedFile() file: Express.Multer.File, body: UploadManifestDto){
    this.logger.log("Upload Manifest")
    const manifest = JSON.parse(file.buffer.toString('utf8'))
    manifest['uploadToken'] = body.uploadToken;
    return this.uploadClient.send(
      UploadTopics.UPLOAD_MANIFEST,
      manifest
    );
  }
  updateUploadStatus(updateUploadStatusDto: UpdateUploadStatusDto){
    this.logger.log(`Update Upload status for id: ${updateUploadStatusDto.catalogId}`)
    return this.uploadClient.send(
      UploadTopics.UPDATE_UPLOAD_STATUS,
      updateUploadStatusDto
    )
  }
  
  getLastVersion(params: {projectId: number}): Observable<{}>{
    return this.uploadClient.send(
      UploadTopics.LAST_VERSION,
      params
    )
  }

  async uploadFile(@Param('objectKey') objectKey: string, @Req() req: Request): Promise<AxiosResponse<any>> {
    this.logger.log(`Uploading file for object key: ${objectKey}`);
    let url = await this.getFileUploadUrl(objectKey);

    const stream = new PassThrough();
    let uploadedBytes = 0;
    const totalSize = parseInt(req.headers['content-length'] || '0', 10);
    this.logger.verbose(`Total size of upload: ${totalSize} bytes`);

    let lastPercent = 0;

    req.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      

      if (totalSize) {
         const percent = ((uploadedBytes / totalSize) * 100);
        if (percent - lastPercent >= 5 || percent === 100) {
          lastPercent = percent;
          this.logger.verbose(
            `Progress: ${percent.toFixed(2)}% (${uploadedBytes}/${totalSize} bytes)`,
          );
        }
        
      } else {
        this.logger.verbose(`Uploaded ${uploadedBytes} bytes so far`);
      }
    });

    req.pipe(stream);

    let response = await axios({
      method: 'put',
      url: url,
      data: stream,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
        'Content-Length': req.headers['content-length'] ?? undefined, 
      },
    });

    let fileUploadStatus: UpdateFileUploadDto = {
      objectKey: objectKey,
      status: FileUPloadStatusEnum.UPLOADED,
      size: totalSize,
      contentType: req.headers['content-type'] as string,
      uploadAt: new Date(),
    };
    this.uploadFileUploadStatus(fileUploadStatus);

    this.logger.log(`File upload completed for object key: ${objectKey}`);
    return response
  }

  async getFileUploadUrl(objectKey: string): Promise<string> {
    let res: FileUploadUrlDto = await lastValueFrom(this.uploadClient.send(UploadTopics.GET_FILE_UPLOAD_URL, { objectKey }));
    this.logger.log(`File upload URL for object key ${objectKey} received: ${res.url}`);
    return res.url;
  }


  uploadFileUploadStatus(file: UpdateFileUploadDto): void {
    this.logger.log(`Updating file upload status for object key: ${file.objectKey}`);
    this.uploadClient.emit(UploadTopicsEmit.UPDATE_FILE_UPLOAD, file);
  }

  checkHealth() {
    return this.uploadClient.send(UploadTopics.CHECK_HEALTH, {})
  }

  async onModuleInit() {
    this.uploadClient.subscribeToResponseOf(Object.values(UploadTopics));
    await this.uploadClient.connect();
  }


  updateFileMetadata(body: UpdateFileDto){
    return this.uploadClient.send(
      UploadTopics.UPDATE_FILE_METADATA,
      body
    )
  }

}
