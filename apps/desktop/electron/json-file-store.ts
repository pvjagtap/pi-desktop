import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class JsonFileStore<T> {
  private readonly rootDir: string;

  constructor(userDataDir: string, subdir: string) {
    this.rootDir = join(userDataDir, subdir);
  }

  async read(sessionKey: string): Promise<T | undefined> {
    const filePath = this.filePath(sessionKey);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupted JSON — back it up and return undefined
      try {
        await rename(filePath, `${filePath}.corrupted`);
      } catch { /* best effort */ }
      return undefined;
    }
  }

  async write(sessionKey: string, data: T): Promise<void> {
    const filePath = this.filePath(sessionKey);
    const tmpPath = `${filePath}.tmp`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
  }

  private filePath(sessionKey: string): string {
    return join(this.rootDir, `${encodeURIComponent(sessionKey)}.json`);
  }
}
