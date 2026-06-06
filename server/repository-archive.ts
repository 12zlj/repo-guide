import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import type { RepoContext } from "./types.js";

export interface RepositoryArchive {
  filePath: string;
  filename: string;
}

function safeArchiveName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "repository";
}

async function addDirectoryToArchive(
  archive: ZipArchive,
  repoPath: string,
  currentPath: string,
  rootName: string
): Promise<number> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  let addedEntries = 0;

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".repo-guide-source.json") continue;

    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(repoPath, absolutePath).split(path.sep).join("/");
    const archivePath = `${rootName}/${relativePath}`;

    if (entry.isDirectory()) {
      const childCount = await addDirectoryToArchive(archive, repoPath, absolutePath, rootName);
      if (childCount === 0) {
        archive.append("", { name: `${archivePath}/` });
        addedEntries += 1;
      } else {
        addedEntries += childCount;
      }
    } else if (entry.isFile()) {
      archive.file(absolutePath, { name: archivePath });
      addedEntries += 1;
    } else if (entry.isSymbolicLink()) {
      archive.symlink(archivePath, await fs.readlink(absolutePath));
      addedEntries += 1;
    }
  }

  return addedEntries;
}

function createFolderArchive(repoPath: string, outputPath: string, rootName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let settled = false;

    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    output.on("close", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.on("error", fail);
    archive.on("error", fail);
    archive.on("warning", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") fail(error);
    });

    archive.pipe(output);
    void (async () => {
      const entryCount = await addDirectoryToArchive(archive, repoPath, repoPath, rootName);
      if (entryCount === 0) {
        archive.append("该仓库当前没有可下载的源码文件。\n", { name: `${rootName}/README.txt` });
      }
      await archive.finalize();
    })().catch(fail);
  });
}

export async function createRepositoryArchive(context: RepoContext): Promise<RepositoryArchive> {
  const rootName = `${safeArchiveName(context.result.repoName)}-source`;
  const filename = `${rootName}.zip`;
  const filePath = path.join(os.tmpdir(), `repo-guide-${context.result.repoId}-${Date.now()}.zip`);

  try {
    await createFolderArchive(context.repoPath, filePath, rootName);
    return { filePath, filename };
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeRepositoryArchive(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true }).catch(() => undefined);
}
