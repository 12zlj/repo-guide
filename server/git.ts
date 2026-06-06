import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

export interface RepoTarget {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  webUrl: string;
}

function cancelledError(): Error {
  return new Error("Analysis cancelled.");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw cancelledError();
  }
}

export function parseGitHubUrl(rawUrl: string): RepoTarget {
  const trimmed = rawUrl.trim();
  let owner = "";
  let name = "";

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    owner = sshMatch[1];
    name = sshMatch[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("请输入有效的 GitHub 仓库 URL。");
    }

    if (parsed.hostname.toLowerCase() !== "github.com") {
      throw new Error("MVP 版本目前只支持 github.com 仓库。");
    }

    const parts = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);

    if (parts.length < 2) {
      throw new Error("GitHub URL 中需要包含 owner/repo。");
    }

    owner = parts[0];
    name = parts[1].replace(/\.git$/i, "");
  }

  const safePart = /^[A-Za-z0-9_.-]+$/;
  if (!safePart.test(owner) || !safePart.test(name)) {
    throw new Error("仓库 owner 或 repo 名称包含不支持的字符。");
  }

  const fullName = `${owner}/${name}`;
  const id = crypto.createHash("sha1").update(fullName.toLowerCase()).digest("hex").slice(0, 16);

  return {
    id,
    owner,
    name,
    fullName,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    webUrl: `https://github.com/${owner}/${name}`
  };
}

function runGit(args: string[], cwd: string, timeoutMs = 120_000, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);

    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      finish(() => reject(cancelledError()));
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`git ${args.join(" ")} 超时。`)));
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(() => resolve(stdout.trim()));
      } else {
        finish(() => reject(new Error(stderr.trim() || `git ${args.join(" ")} 失败，退出码 ${code}`)));
      }
    });
  });
}

function isInside(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function downloadBuffer(url: string, timeoutMs = 90_000, signal?: AbortSignal): Promise<Buffer> {
  throwIfAborted(signal);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "repo-guide-mvp"
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) {
        throw cancelledError();
      }
      throw new Error(`下载超时：${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function getDefaultBranch(target: RepoTarget, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const buffer = await downloadBuffer(`https://api.github.com/repos/${target.owner}/${target.name}`, 30_000, signal);
    const payload = JSON.parse(buffer.toString("utf8")) as { default_branch?: string };
    return payload.default_branch;
  } catch {
    return undefined;
  }
}

async function extractGitHubArchive(buffer: Buffer, destinationPath: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const firstEntry = entries.find((entry) => entry.entryName.includes("/"));
  const rootPrefix = firstEntry?.entryName.split("/")[0] ?? "";

  await fs.mkdir(destinationPath, { recursive: true });

  for (const entry of entries) {
    throwIfAborted(signal);

    const relativeName = rootPrefix && entry.entryName.startsWith(`${rootPrefix}/`)
      ? entry.entryName.slice(rootPrefix.length + 1)
      : entry.entryName;

    if (!relativeName) {
      continue;
    }

    const resolvedPath = path.resolve(destinationPath, relativeName);
    if (!isInside(destinationPath, resolvedPath)) {
      throw new Error("GitHub ZIP 中包含不安全路径，已停止解压。");
    }

    if (entry.isDirectory) {
      await fs.mkdir(resolvedPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, entry.getData());
    }
  }
}

async function downloadRepoArchive(target: RepoTarget, repoPath: string, gitError: Error, signal?: AbortSignal): Promise<void> {
  const branches = [
    await getDefaultBranch(target, signal),
    "main",
    "master"
  ].filter((branch): branch is string => Boolean(branch));

  const errors: string[] = [];
  for (const branch of [...new Set(branches)]) {
    throwIfAborted(signal);

    const archiveUrl = `https://codeload.github.com/${target.owner}/${target.name}/zip/refs/heads/${encodeURIComponent(branch)}`;
    try {
      const buffer = await downloadBuffer(archiveUrl, 90_000, signal);
      await extractGitHubArchive(buffer, repoPath, signal);
      await fs.writeFile(
        path.join(repoPath, ".repo-guide-source.json"),
        JSON.stringify({ source: "github-zip", branch, downloadedAt: new Date().toISOString() }, null, 2)
      );
      return;
    } catch (error) {
      errors.push(`${branch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `无法拉取仓库。git clone 失败：${gitError.message}\nZIP 兜底也失败：${errors.join("；") || "没有可用分支"}`
  );
}

async function hasUsableCache(repoPath: string): Promise<boolean> {
  return (await exists(path.join(repoPath, ".git"))) || (await exists(path.join(repoPath, ".repo-guide-source.json")));
}

export async function ensureRepoCloned(target: RepoTarget, workspaceRoot: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);

  const reposRoot = path.resolve(workspaceRoot, ".repos");
  await fs.mkdir(reposRoot, { recursive: true });

  const repoPath = path.join(reposRoot, target.id);
  if (await hasUsableCache(repoPath)) {
    return repoPath;
  }

  if (await exists(repoPath)) {
    if (!isInside(reposRoot, repoPath)) {
      throw new Error(`缓存目录不在预期位置：${repoPath}`);
    }
    await fs.rm(repoPath, { recursive: true, force: true });
  }

  try {
    await runGit(["clone", "--depth", "1", target.cloneUrl, repoPath], workspaceRoot, 120_000, signal);
  } catch (error) {
    if (await exists(repoPath)) {
      await fs.rm(repoPath, { recursive: true, force: true });
    }
    throwIfAborted(signal);
    try {
      await downloadRepoArchive(target, repoPath, error instanceof Error ? error : new Error(String(error)), signal);
    } catch (fallbackError) {
      if (signal?.aborted && await exists(repoPath)) {
        await fs.rm(repoPath, { recursive: true, force: true });
      }
      throw fallbackError;
    }
  }

  return repoPath;
}
