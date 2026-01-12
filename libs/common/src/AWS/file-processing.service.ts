import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import stream from 'stream';
import { PassThrough } from 'stream';

export interface FileProcessingOptions {
  /** Whether to calculate SHA256 hash. Defaults to true if not specified */
  calculateSha256?: boolean;
  /** Whether to calculate Cosign signature. Defaults to false if not specified */
  calculateCosign?: boolean;
}

export interface FileProcessingResult {
  sha256?: string;
  cosignSignature?: Buffer;
}

@Injectable()
export class FileProcessingService {
  private readonly logger = new Logger(FileProcessingService.name);
  private readonly privateKeyPath: string;
  private readonly password: string;

  constructor(private readonly configService: ConfigService) {
    try {
      this.password = this.configService.getOrThrow<string>('COSIGN_PASSWORD');
      this.privateKeyPath = this.configService.getOrThrow<string>('COSIGN_PRIVATE_KEY_PATH');
    } catch (error) {
      this.logger.error('Missing required COSIGN configuration environment variables.', error);
    }
  }

  /**
   * Process a file stream to calculate SHA256 hash and/or Cosign signature
   * Efficiently handles both operations from a single stream by splitting it when needed
   * 
   * @param fileStream - The readable stream of the file to process
   * @param options - Options to specify what to calculate (sha256, cosign, or both)
   * @returns Promise with the requested calculations
   */
  async processFile(
    fileStream: stream.Readable,
    options: FileProcessingOptions = {}
  ): Promise<FileProcessingResult> {
    // Default: SHA256 is calculated unless explicitly set to false, Cosign is not calculated unless explicitly set to true
    const calculateSha256 = options.calculateSha256 !== false;
    const calculateCosign = options.calculateCosign === true;

    if (!calculateSha256 && !calculateCosign) {
      throw new BadRequestException('At least one processing option must be enabled');
    }

    // If only one operation is needed, process directly without stream splitting
    if (calculateSha256 && !calculateCosign) {
      const sha256 = await this.calculateSha256(fileStream);
      return { sha256 };
    }

    if (calculateCosign && !calculateSha256) {
      const cosignSignature = await this.signWithCosign(fileStream);
      return { cosignSignature };
    }

    // Both operations needed - split the stream efficiently
    return this.processFileWithBothOperations(fileStream);
  }

  /**
   * Process file with both SHA256 and Cosign signature by splitting the stream
   */
  private async processFileWithBothOperations(
    sourceStream: stream.Readable
  ): Promise<FileProcessingResult> {
    this.logger.debug('Processing file with both SHA256 and Cosign signature');

    // Create two PassThrough streams to split the original stream
    const sha256Stream = new PassThrough();
    const cosignStream = new PassThrough();

    // Start both operations in parallel
    const sha256Promise = this.calculateSha256(sha256Stream);
    const cosignPromise = this.signWithCosign(cosignStream);

    // Pipe the source stream to both PassThrough streams
    sourceStream.on('data', (chunk) => {
      sha256Stream.write(chunk);
      cosignStream.write(chunk);
    });

    sourceStream.on('end', () => {
      sha256Stream.end();
      cosignStream.end();
    });

    sourceStream.on('error', (error) => {
      sha256Stream.destroy(error);
      cosignStream.destroy(error);
    });

    try {
      // Wait for both operations to complete
      const [sha256, cosignSignature] = await Promise.all([sha256Promise, cosignPromise]);
      return { sha256, cosignSignature };
    } catch (error) {
      this.logger.error('Error processing file with both operations', error);
      throw error;
    }
  }

  /**
   * Calculate SHA256 hash from a stream
   */
  private async calculateSha256(fileStream: stream.Readable): Promise<string> {
    this.logger.debug('Calculating SHA256 hash');
    const hash = createHash('sha256');

    return new Promise<string>((resolve, reject) => {
      fileStream.on('data', (chunk) => hash.update(chunk));
      fileStream.on('end', () => resolve(hash.digest('hex')));
      fileStream.on('error', reject);
    });
  }

  /**
   * Sign a file stream with Cosign
   */
  private async signWithCosign(fileStream: stream.Readable): Promise<Buffer> {
    this.logger.debug('Signing file with Cosign');

    const env = { ...process.env };
    env.COSIGN_PASSWORD = this.password;

    return new Promise<Buffer>((resolve, reject) => {
      const cosign = spawn(
        'cosign',
        ['sign-blob', '-', '--key', this.privateKeyPath, '--tlog-upload=false'],
        { env }
      );

      let signature = Buffer.alloc(0);

      cosign.on('error', (err) => {
        this.logger.error(`Failed to spawn cosign process: ${err.message}`);
        reject(new Error(`Cosign spawn failed: ${err.message}`));
      });

      cosign.stdout.on('data', (chunk) => {
        this.logger.log(`Received cosign chunk of size: ${chunk.length}`);
        signature = Buffer.concat([signature, chunk]);
      });

      cosign.stderr.on('data', (chunk) => this.logger.warn(chunk.toString()));

      cosign.on('exit', (code) => {
        if (code === 0) {
          resolve(signature);
        } else {
          reject(new Error(`Cosign exited with code ${code}`));
        }
      });

      // Pipe file stream into Cosign stdin
      fileStream.pipe(cosign.stdin);
      fileStream.on('error', (err) => reject(err));
    });
  }
}
