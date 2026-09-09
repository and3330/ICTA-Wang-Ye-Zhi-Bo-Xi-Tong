import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@replit/object-storage";

export interface UploadStorage {
  put(key: string, contents: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

class ObjectUploadStorage implements UploadStorage {
  private client: Client | undefined;

  constructor(private readonly createClient: () => Client) {}

  private getClient() {
    this.client ??= this.createClient();
    return this.client;
  }

  private async withClient<T>(operation: (client: Client) => Promise<T>) {
    const client = this.getClient();
    try {
      return await operation(client);
    } catch (error) {
      if (this.client === client) this.client = undefined;
      throw error;
    }
  }

  async put(key: string, contents: Buffer) {
    const result = await this.withClient((client) => client.uploadFromBytes(key, contents));
    if (!result.ok) throw new Error(result.error.message);
  }

  async get(key: string) {
    const result = await this.withClient((client) => client.downloadAsBytes(key));
    if (!result.ok) {
      if (result.error.statusCode === 404) return null;
      throw new Error(result.error.message);
    }
    return result.value[0];
  }

  async delete(key: string) {
    const result = await this.withClient((client) => client.delete(key, { ignoreNotFound: true }));
    if (!result.ok) throw new Error(result.error.message);
  }
}

export function createObjectUploadStorage(
  createClient: () => Client = () => new Client(),
): UploadStorage {
  return new ObjectUploadStorage(createClient);
}

class LocalUploadStorage implements UploadStorage {
  constructor(private readonly directory: string) {}
  private filename(key: string) {
    return path.join(this.directory, key.startsWith("uploads/") ? key.slice("uploads/".length) : key);
  }

  async put(key: string, contents: Buffer) {
    const filename = this.filename(key);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, contents, { flag: "wx" });
  }

  async get(key: string) {
    try {
      return await fs.readFile(this.filename(key));
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    await fs.rm(this.filename(key), { force: true });
  }
}

/** Object Storage is the production default; local storage remains useful for dev and legacy files. */
export function createUploadStorage(directory: string): UploadStorage {
  return process.env.NODE_ENV === "production"
    ? createObjectUploadStorage()
    : new LocalUploadStorage(directory);
}

let injectedStorage: UploadStorage | undefined;
export function setUploadStorageForTests(storage: UploadStorage | undefined) {
  injectedStorage = storage;
}

export function getUploadStorage(directory: string): UploadStorage {
  return injectedStorage ?? createUploadStorage(directory);
}

export const uploadObjectKey = (filename: string) => `uploads/${filename}`;