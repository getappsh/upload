import { ArtifactTypeEnum } from "@app/common/database/entities";
import { BrowseRegistryDto, BrowseRegistryResponseDto, RegistryItemDto } from "@app/common/dto/upload";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MinioClientService } from "@app/common/AWS/minio-client.service";
import { gunzipSync } from 'zlib';
import axios from 'axios';
import { getRepos, getTags } from '@snyk/docker-registry-v2-client';

interface RegistryConfig {
  url: string;
  username?: string;
  password?: string;
}

@Injectable()
export class RegistryBrowseService implements OnModuleInit {
  private readonly logger = new Logger(RegistryBrowseService.name);
  private readonly bucketName: string;
  private dockerRegistries: RegistryConfig[] = [];
  private rpmRegistries: RegistryConfig[] = [];
  private aptRegistries: RegistryConfig[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly minioClient: MinioClientService,
  ) {
    this.bucketName = this.configService.get('BUCKET_NAME');
  }

  onModuleInit() {
    this.loadRegistryConfigs();
  }

  private loadRegistryConfigs() {
    const dockerUrls = this.configService.get<string>('DOCKER_REGISTRY_URL');
    const dockerUsername = this.configService.get<string>('DOCKER_REGISTRY_USERNAME');
    const dockerPassword = this.configService.get<string>('DOCKER_REGISTRY_PASSWORD');

    if (dockerUrls) {
      this.dockerRegistries = dockerUrls.split(',').map(url => ({
        url: url.trim(),
        username: dockerUsername,
        password: dockerPassword,
      }));
    } else {
      // Default to Docker Hub
      this.dockerRegistries = [{ url: 'https://registry-1.docker.io' }];
    }

    const rpmUrl = this.configService.get<string>('RPM_REGISTRY_URL');
    const rpmUsername = this.configService.get<string>('RPM_REGISTRY_USERNAME');
    const rpmPassword = this.configService.get<string>('RPM_REGISTRY_PASSWORD');

    if (rpmUrl) {
      this.rpmRegistries = rpmUrl.split(',').map(url => ({
        url: url.trim(),
        username: rpmUsername,
        password: rpmPassword,
      }));
    }

    const aptUrl = this.configService.get<string>('APT_REGISTRY_URL');
    const aptUsername = this.configService.get<string>('APT_REGISTRY_USERNAME');
    const aptPassword = this.configService.get<string>('APT_REGISTRY_PASSWORD');

    if (aptUrl) {
      this.aptRegistries = aptUrl.split(',').map(url => ({
        url: url.trim(),
        username: aptUsername,
        password: aptPassword,
      }));
    }

    this.logger.log(`Registry configs loaded: docker=${this.dockerRegistries.length}, rpm=${this.rpmRegistries.length}, apt=${this.aptRegistries.length}`);
  }

  async browse(dto: BrowseRegistryDto): Promise<BrowseRegistryResponseDto> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 50;

    let allItems: RegistryItemDto[] = [];

    if (!dto.type || dto.type === ArtifactTypeEnum.FILE) {
      const fileItems = await this.listMinioFiles(dto.name);
      allItems.push(...fileItems);

      // Also query RPM and APT registries (these are "file" type artifacts)
      const rpmItems = await this.listRpmPackages(dto.name);
      allItems.push(...rpmItems);

      const aptItems = await this.listAptPackages(dto.name);
      allItems.push(...aptItems);
    }

    if (!dto.type || dto.type === ArtifactTypeEnum.DOCKER_IMAGE) {
      const dockerItems = await this.listDockerImages(dto.name, dto.registry);
      allItems.push(...dockerItems);
    }

    // Apply name filter for combined results
    if (dto.name) {
      const lowerName = dto.name.toLowerCase();
      allItems = allItems.filter(item => item.name.toLowerCase().includes(lowerName));
    }

    const total = allItems.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const items = allItems.slice(startIndex, startIndex + pageSize);

    return { items, total, page, pageSize, totalPages };
  }

  // ─── MinIO/S3 Files ────────────────────────────────────────────────

  private async listMinioFiles(nameFilter?: string): Promise<RegistryItemDto[]> {
    try {
      const prefix = 'upload/';
      const objects = await this.minioClient.listObjects(this.bucketName, prefix, true);
      return objects.map(obj => ({
        name: obj.name,
        type: ArtifactTypeEnum.FILE,
        size: obj.size,
        lastModified: obj.lastModified,
      }));
    } catch (error: any) {
      this.logger.error(`Error listing MinIO files: ${error.message}`);
      return [];
    }
  }

  // ─── Docker Registry (HTTP V2 API) ─────────────────────────────────

  private async listDockerImages(nameFilter?: string, registryName?: string): Promise<RegistryItemDto[]> {
    const items: RegistryItemDto[] = [];
    const registries = registryName
      ? this.dockerRegistries.filter(r => r.url.includes(registryName))
      : this.dockerRegistries;

    for (const registry of registries) {
      try {
        const registryBase = registry.url.replace(/\/$/, '').replace(/^https?:\/\//, '');
        const isDockerHub = registryBase.includes('docker.io');
        const options = registry.url.startsWith('http://') ? { protocol: 'http:' } : undefined;

        const repos = isDockerHub
          ? await this.fetchDockerHubRepositories(registry)
          : await getRepos(registryBase, registry.username, registry.password, undefined, undefined, options);

        for (const repo of repos) {
          const tags = await getTags(registryBase, repo, registry.username, registry.password, undefined, undefined, options);
          for (const tag of tags) {
            const fullName = `${registryBase}/${repo}:${tag}`;
            items.push({
              name: fullName,
              type: ArtifactTypeEnum.DOCKER_IMAGE,
              tag,
            });
          }
        }
      } catch (error: any) {
        this.logger.error(`Error listing docker images from ${registry.url}: ${error.message}`);
      }
    }

    return items;
  }

  /**
   * Lists repositories from Docker Hub using hub.docker.com API.
   * Docker Hub does not support /v2/_catalog, so we use the Hub API instead.
   */
  private async fetchDockerHubRepositories(registry: RegistryConfig): Promise<string[]> {
    if (!registry.username) {
      this.logger.warn('Docker Hub requires DOCKER_REGISTRY_USERNAME to list repositories');
      return [];
    }

    const namespace = registry.username;
    const url = `https://hub.docker.com/v2/repositories/${namespace}/?page_size=100`;
    const headers: Record<string, string> = {};

    if (registry.password) {
      try {
        const loginRes = await axios.post<{ token?: string }>(
          'https://hub.docker.com/v2/users/login/',
          { username: registry.username, password: registry.password },
          { timeout: 10000 },
        );
        if (loginRes.data.token) {
          headers['Authorization'] = `JWT ${loginRes.data.token}`;
        }
      } catch (e: any) {
        this.logger.warn(`Docker Hub login failed: ${e.message}, trying without auth`);
      }
    }

    const res = await axios.get<{ results?: { name: string }[] }>(url, { headers, timeout: 30000 });
    return (res.data.results || []).map(r => `${namespace}/${r.name}`);
  }

  // ─── RPM Registry (HTTP metadata parsing) ─────────────────────────

  /**
   * Queries RPM repositories by fetching and parsing the repodata metadata over HTTP.
   * Flow: GET repodata/repomd.xml → find primary.xml.gz href → GET & gunzip → parse package names.
   */
  private async listRpmPackages(nameFilter?: string): Promise<RegistryItemDto[]> {
    const items: RegistryItemDto[] = [];

    for (const registry of this.rpmRegistries) {
      try {
        const packages = await this.fetchRpmPackages(registry, nameFilter);
        items.push(...packages);
      } catch (error: any) {
        this.logger.error(`Error listing RPM packages from ${registry.url}: ${error.message}`);
      }
    }

    return items;
  }

  private async fetchRpmPackages(registry: RegistryConfig, nameFilter?: string): Promise<RegistryItemDto[]> {
    const baseUrl = registry.url.replace(/\/$/, '');
    const headers = this.buildAuthHeaders(registry);

    // Step 1: fetch repomd.xml to find the primary metadata file
    const repomdUrl = `${baseUrl}/repodata/repomd.xml`;
    let repomdXml: string;
    try {
      const repomdRes = await axios.get<string>(repomdUrl, { headers, timeout: 30000, responseType: 'text' });
      repomdXml = repomdRes.data;
    } catch (e: any) {
      this.logger.warn(`RPM repomd.xml not accessible at ${repomdUrl}: ${e.response?.status || e.message}`);
      return [];
    }

    // Extract the primary.xml.gz href from repomd.xml
    const primaryMatch = repomdXml.match(/<data type="primary">[\s\S]*?<location href="([^"]+)"[\s\S]*?<\/data>/);
    if (!primaryMatch) {
      this.logger.warn(`Could not find primary metadata in repomd.xml from ${baseUrl}`);
      return [];
    }
    const primaryHref = primaryMatch[1];

    // Step 2: fetch and decompress primary.xml.gz
    const primaryUrl = `${baseUrl}/${primaryHref}`;
    let compressedBuf: Buffer;
    try {
      const primaryRes = await axios.get(primaryUrl, { headers, timeout: 60000, responseType: 'arraybuffer' });
      compressedBuf = Buffer.from(primaryRes.data);
    } catch (e: any) {
      this.logger.warn(`RPM primary metadata not accessible at ${primaryUrl}: ${e.response?.status || e.message}`);
      return [];
    }
    let xmlContent: string;
    if (primaryHref.endsWith('.gz')) {
      xmlContent = gunzipSync(new Uint8Array(compressedBuf)).toString('utf-8');
    } else {
      xmlContent = compressedBuf.toString('utf-8');
    }

    // Step 3: parse package names from the XML
    // Each package: <package type="rpm"><name>...</name><version ... ver="..." rel="..."/><arch>...</arch>
    const packageRegex = /<package type="rpm">[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<version[^>]*ver="([^"]*)"[^>]*rel="([^"]*)"[^>]*\/>[\s\S]*?<arch>([^<]+)<\/arch>/g;
    const items: RegistryItemDto[] = [];
    let match: RegExpExecArray | null;

    while ((match = packageRegex.exec(xmlContent)) !== null) {
      const [, name, version, release, arch] = match;
      const fullName = `${name}-${version}-${release}.${arch}`;

      if (nameFilter && !fullName.toLowerCase().includes(nameFilter.toLowerCase())) {
        continue;
      }

      items.push({
        name: fullName,
        type: ArtifactTypeEnum.FILE,
        tag: version,
      });
    }

    return items;
  }

  // ─── APT Registry (HTTP Packages file parsing) ─────────────────────

  /**
   * Queries APT repositories by fetching the Packages.gz (or Packages) index over HTTP.
   * Standard layout: {url}/dists/{dist}/{component}/binary-{arch}/Packages.gz
   * Simpler flat layout: {url}/Packages.gz or {url}/Packages
   */
  private async listAptPackages(nameFilter?: string): Promise<RegistryItemDto[]> {
    const items: RegistryItemDto[] = [];

    for (const registry of this.aptRegistries) {
      try {
        const packages = await this.fetchAptPackages(registry, nameFilter);
        items.push(...packages);
      } catch (error: any) {
        this.logger.error(`Error listing APT packages from ${registry.url}: ${error.message}`);
      }
    }

    return items;
  }

  private async fetchAptPackages(registry: RegistryConfig, nameFilter?: string): Promise<RegistryItemDto[]> {
    const baseUrl = registry.url.replace(/\/$/, '');
    const headers = this.buildAuthHeaders(registry);

    // Try common Packages file locations
    const candidates = [
      `${baseUrl}/Packages.gz`,
      `${baseUrl}/Packages`,
      `${baseUrl}/dists/stable/main/binary-amd64/Packages.gz`,
      `${baseUrl}/dists/stable/main/binary-amd64/Packages`,
    ];

    let packagesContent: string | null = null;

    for (const url of candidates) {
      try {
        const res = await axios.get(url, { headers, timeout: 30000, responseType: 'arraybuffer' });
        const buf = Buffer.from(res.data);
        if (url.endsWith('.gz')) {
          packagesContent = gunzipSync(new Uint8Array(buf)).toString('utf-8');
        } else {
          packagesContent = buf.toString('utf-8');
        }
        break;
      } catch {
        continue;
      }
    }

    if (!packagesContent) {
      this.logger.warn(`Could not fetch Packages index from ${baseUrl}`);
      return [];
    }

    // Parse the Packages file: paragraphs separated by blank lines
    // Each paragraph has: Package: name\nVersion: ver\nArchitecture: arch\n...
    const items: RegistryItemDto[] = [];
    const paragraphs = packagesContent.split('\n\n');

    for (const paragraph of paragraphs) {
      const nameMatch = paragraph.match(/^Package:\s*(.+)$/m);
      const versionMatch = paragraph.match(/^Version:\s*(.+)$/m);
      const sizeMatch = paragraph.match(/^Size:\s*(\d+)$/m);

      if (!nameMatch) continue;

      const pkgName = nameMatch[1].trim();
      const version = versionMatch?.[1]?.trim();
      const fullName = version ? `${pkgName}_${version}` : pkgName;

      if (nameFilter && !fullName.toLowerCase().includes(nameFilter.toLowerCase())) {
        continue;
      }

      items.push({
        name: fullName,
        type: ArtifactTypeEnum.FILE,
        tag: version,
        size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
      });
    }

    return items;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private buildAuthHeaders(registry: RegistryConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    if (registry.username && registry.password) {
      const auth = Buffer.from(`${registry.username}:${registry.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    return headers;
  }
}
