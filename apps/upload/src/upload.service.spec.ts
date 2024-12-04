import { Test, TestingModule } from '@nestjs/testing';
import { UploadService } from './upload.service';
import { S3Service } from '@app/common/AWS/s3.service';
import { DockerDownloadService } from './docker-download.service';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UploadVersionEntity, UploadStatus, ProjectEntity } from '@app/common/database/entities';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { mockProjectRepo, mockUploadVersionRepo } from '@app/common/database/test/support/__mocks__';
import { UpdateUploadStatusDto, uploadArtifactDtoStub } from '@app/common/dto/upload';
import { Repository } from 'typeorm';
import { projectEntityStub, uploadVersionEntityStub } from '@app/common/database/test/support/stubs';
import { ComponentDto } from '@app/common/dto/discovery';

// Mock the dependencies
class S3ServiceMock {
  uploadFile = jest.fn();
  generatePresignedUrlForUpload = jest.fn().mockResolvedValue('path/to/upload/s3');
}

class DockerDownloadServiceMock {
  downloadDockerImage = jest.fn().mockResolvedValue("path/to/the/image/local");
  deleteImageDir = jest.fn();
}

class JwtServiceMock {
  verify = jest.fn().mockReturnValue({data: {projectId: 34}});
}


describe('UploadService', () => {
  let service: UploadService;
  let uploadVersionRepo: Repository<UploadVersionEntity>;
  let projectRepo: Repository<ProjectEntity>;
  let s3Service: S3ServiceMock;
  let dockerDownloadService: DockerDownloadServiceMock;
  let jwtService: JwtServiceMock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        { provide: S3Service, useClass: S3ServiceMock },
        { provide: DockerDownloadService, useClass: DockerDownloadServiceMock },
        { provide: JwtService, useClass: JwtServiceMock },
        { provide: getRepositoryToken(UploadVersionEntity), useValue: mockUploadVersionRepo()},
        { provide: getRepositoryToken(ProjectEntity), useValue: mockProjectRepo() },
      ],
    }).compile();

    service = module.get<UploadService>(UploadService);
    uploadVersionRepo = module.get<Repository<UploadVersionEntity>>(getRepositoryToken(UploadVersionEntity));
    projectRepo = module.get<Repository<ProjectEntity>>(getRepositoryToken(ProjectEntity));
    s3Service = module.get<S3ServiceMock>(S3Service);
    dockerDownloadService = module.get<DockerDownloadServiceMock>(DockerDownloadService);
    jwtService = module.get<JwtServiceMock>(JwtService);
  });

  describe('uploadArtifact', () => {
    it('should save and move the image to S3', async () => {
      const artifactDto = uploadArtifactDtoStub();
      delete artifactDto.uploadToken;
      const uploadVersion = UploadVersionEntity.fromArtifact({...artifactDto}as any);
      const newVersion = uploadVersionEntityStub()


      let result = await service.uploadArtifact(artifactDto);
      expect(result.version == newVersion.version)
      expect(uploadVersionRepo.save).toHaveBeenCalledWith(uploadVersion);

    });

    it('should throw ConflictException when version already exists', async () => {
      const artifactDto = uploadArtifactDtoStub();
      delete artifactDto.uploadToken;
      const uploadVersion = UploadVersionEntity.fromArtifact({...artifactDto}as any);

      jest.spyOn(uploadVersionRepo, 'save').mockRejectedValueOnce({code: '23505'})

      await expect(service.uploadArtifact(artifactDto)).rejects.toThrow(ConflictException);
      expect(uploadVersionRepo.save).toHaveBeenCalledWith(uploadVersion);
      expect(dockerDownloadService.downloadDockerImage).not.toHaveBeenCalled();
      expect(s3Service.uploadFile).not.toHaveBeenCalled();
      expect(dockerDownloadService.deleteImageDir).not.toHaveBeenCalled();
    });
  });

  describe('uploadManifest', () => {
    it('should save and return the catalogId and uploadUrl', async () => {
      const artifactDto = uploadArtifactDtoStub();
      const manifest = { 
        product: artifactDto.platform, 
        formation: artifactDto.formation, 
        version: artifactDto.version, 
        project: 1, 
        url: artifactDto.url};
      const newUpload = UploadVersionEntity.fromManifest({...manifest} as any);
      const newVersion = uploadVersionEntityStub()

      const result = await service.uploadManifest(manifest);
      expect(result).toEqual({ catalogId: newVersion.catalogId, uploadUrl: expect.any(String) });
     
      expect(uploadVersionRepo.findOne).toBeCalledWith({
        where: {
          platform: newUpload.platform,
          component: newUpload.component,
          formation: newUpload.formation,
          version: newUpload.version
        }
      });

      expect(uploadVersionRepo.save).toBeCalledWith({...newUpload, s3Url: expect.any(String)});
      expect(s3Service.generatePresignedUrlForUpload).toHaveBeenCalledWith(expect.any(String));
    });

    it('should return existing catalogId and uploadUrl of upload that has an error', async () => {
      const artifactDto = uploadArtifactDtoStub();
      const manifest = { 
        product: artifactDto.platform, 
        formation: artifactDto.formation, 
        version: artifactDto.version, 
        project: 1, 
        url: artifactDto.url};
      const newUpload = UploadVersionEntity.fromManifest({...manifest} as any);
      let newVersion = uploadVersionEntityStub()

      newVersion.uploadStatus = UploadStatus.ERROR;
      jest.spyOn(uploadVersionRepo, 'findOne').mockResolvedValueOnce(newVersion)

      const result = await service.uploadManifest(manifest);
      expect(result).toEqual({ catalogId: newVersion.catalogId, uploadUrl: expect.any(String) });
     
      expect(uploadVersionRepo.findOne).toBeCalledWith({
        where: {
          platform: newUpload.platform,
          component: newUpload.component,
          formation: newUpload.formation,
          version: newUpload.version
        }
      });

      expect(uploadVersionRepo.save).not.toBeCalled();
      expect(s3Service.generatePresignedUrlForUpload).toHaveBeenCalledWith(expect.any(String));
    });

    it('should throw ConflictException when version already exists', async () => {
      const artifactDto = uploadArtifactDtoStub();
      const manifest = { 
        product: artifactDto.platform, 
        formation: artifactDto.formation, 
        version: artifactDto.version, 
        project: 1, 
        url: artifactDto.url};

        jest.spyOn(uploadVersionRepo, 'save').mockRejectedValueOnce({code: '23505'})

      await expect(service.uploadManifest(manifest)).rejects.toThrow(ConflictException);
      expect(uploadVersionRepo.save).toHaveBeenCalled();
      expect(s3Service.generatePresignedUrlForUpload).not.toHaveBeenCalled();
    });
  });

  describe('updateUploadStatus', () => {
    it('should update the upload status', async () => {
      const updateUploadStatusDto = { catalogId: 1, status: UploadStatus.DOWNLOADING_FROM_URL, uploadToken: "test-token"} as unknown as UpdateUploadStatusDto;

      await service.updateUploadStatus(updateUploadStatusDto);

      expect(uploadVersionRepo.update).toHaveBeenCalledWith(
        { catalogId: updateUploadStatusDto.catalogId },
        { uploadStatus: updateUploadStatusDto.status },
      );
    });

    it('should throw NotFoundException when upload version is not found', async () => {
      const updateUploadStatusDto = { catalogId: 1, status: UploadStatus.DOWNLOADING_FROM_URL,  uploadToken: "test-token"} as unknown as UpdateUploadStatusDto;
      jest.spyOn(uploadVersionRepo, 'update').mockResolvedValueOnce({affected: 0} as any)
      await expect(service.updateUploadStatus(updateUploadStatusDto)).rejects.toThrow(NotFoundException);
      expect(uploadVersionRepo.update).toHaveBeenCalledWith(
        { catalogId: updateUploadStatusDto.catalogId },
        { uploadStatus: updateUploadStatusDto.status },
      );
    });
  });

  describe('getLastVersion', () => {
    it('should return the last version of a component', async () => {
      const params = { projectId: 1 };
      const result = await service.getLastVersion(params);

      expect(result).toEqual(expect.any(ComponentDto));

      expect(uploadVersionRepo.findOne).toHaveBeenCalledWith({
        where: {
          project: { id: params.projectId },
        },
        order: {
          version: 'DESC',
        },
      });
    });

    it('should throw NotFoundException when component is not found', async () => {
      const params = { projectId: 1 };
      jest.spyOn(uploadVersionRepo, 'findOne').mockResolvedValueOnce(null)

      await expect(service.getLastVersion(params)).rejects.toThrow(NotFoundException);
      expect(uploadVersionRepo.findOne).toBeCalled();
    });
  });

  describe('verifyToken', () => {
    it('should verify the token and return the project', async () => {
      const project = projectEntityStub()
      const token = project.tokens[0];

      const result = await service.verifyToken(token);

      expect(result).toEqual(project);

      expect(jwtService.verify).toHaveBeenCalledWith(token);
      expect(projectRepo.findOne).toHaveBeenCalledWith({ where: { id: expect.anything() } });
    });

    it('should throw HttpException when token is not allowed in the project', async () => {
      const token = 'unallowedToken';


      await expect(service.verifyToken(token)).rejects.toThrow(HttpException);
      expect(jwtService.verify).toHaveBeenCalledWith(token);
      expect(projectRepo.findOne).toHaveBeenCalledWith({ where: { id: expect.anything() } });
    });
  });
});
