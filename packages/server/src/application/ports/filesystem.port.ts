export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
}
