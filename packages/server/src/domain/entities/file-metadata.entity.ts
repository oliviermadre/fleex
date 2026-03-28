import type { FileMetadata } from '@fleex/shared';

export class FileMetadataEntity {
  constructor(
    public readonly id: string,
    public readonly originalName: string,
    public readonly mimeType: string,
    public readonly sizeBytes: number,
    public readonly createdAt: Date,
  ) {}

  static create(params: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  }): FileMetadataEntity {
    return new FileMetadataEntity(
      params.id,
      params.originalName,
      params.mimeType,
      params.sizeBytes,
      new Date(),
    );
  }

  toDTO(): FileMetadata {
    return {
      id: this.id,
      originalName: this.originalName,
      mimeType: this.mimeType,
      sizeBytes: this.sizeBytes,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
