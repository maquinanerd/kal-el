export interface StorageProvider {
  readonly name: string;
  put(input: { key: string; data: Buffer; mimeType: string }): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
