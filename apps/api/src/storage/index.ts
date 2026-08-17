import type { AppConfig } from "../config.js";
import { LocalStorageProvider } from "./local.js";
import type { StorageProvider } from "./provider.js";

export function createStorageProvider(config: AppConfig): StorageProvider {
  switch (config.MEDIA_STORAGE_PROVIDER) {
    case "local":
      return new LocalStorageProvider(config.MEDIA_LOCAL_PATH);
    default:
      throw new Error(`unsupported media storage provider: ${config.MEDIA_STORAGE_PROVIDER}`);
  }
}

export type { StorageProvider } from "./provider.js";
