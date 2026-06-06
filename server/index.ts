import cors from "cors";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { analyzeRepository } from "./analyzer.js";
import { ensureRepoCloned, parseGitHubUrl } from "./git.js";
import { generateRunGuide } from "./run-guide.js";
import { createRepositoryArchive, removeRepositoryArchive } from "./repository-archive.js";
import {
  addDownloadRecord,
  buildPersonalCenterData,
  createReportFile,
  deleteAnalysisRecord,
  getAnalysisRecordDetail,
  getDownloadRecord,
  getProfileUser,
  recordAnalysisFailure,
  recordAnalysisSuccess,
  seedProfileUsers,
  setFavorite,
  touchLastLogin,
  updateProfileUser,
  type ProfileUser,
  type ReportFile,
  type ReportFormat
} from "./profile.js";
import type { NextFunction, Request, Response } from "express";
import type { RepoContext } from "./types.js";

const workspaceRoot = process.cwd();
const app = express();
const port = Number(process.env.PORT ?? 4174);
const contexts = new Map<string, RepoContext>();
let latestRepoId: string | undefined;
const sessions = new Map<string, StoredSession>();
const sessionCookieName = "repo_guide_session";
const sessionTtlMs = 8 * 60 * 60 * 1000;
const rememberedSessionTtlMs = 7 * 24 * 60 * 60 * 1000;

interface DemoUser extends ProfileUser {
  password: string;
}

interface StoredSession {
  token: string;
  email: string;
  expiresAt: number;
}

type AuthenticatedRequest = Request & { user?: ProfileUser };

const demoUsers: DemoUser[] = [
  {
    email: "demo@repoguide.dev",
    password: "RepoGuide@123",
    name: "演示用户",
    role: "项目分析师",
    team: "Repo Guide Lab",
    avatarUrl: "",
    registeredAt: "2026-01-08T09:30:00.000Z",
    lastLoginAt: "2026-06-01T10:12:00.000Z"
  },
  {
    email: "admin@repoguide.dev",
    password: "Admin@123",
    name: "管理员",
    role: "平台管理员",
    team: "Repo Guide Lab",
    avatarUrl: "",
    registeredAt: "2026-01-01T08:00:00.000Z",
    lastLoginAt: "2026-06-01T11:20:00.000Z"
  }
];

seedProfileUsers(demoUsers.map(({ password: _password, ...user }) => user));

function isCancelled(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.message === "Analysis cancelled.");
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((cookies, item) => {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (!rawName) return cookies;
    cookies[decodeURIComponent(rawName)] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function getSession(request: Request): StoredSession | undefined {
  const token = parseCookieHeader(request.headers.cookie)[sessionCookieName];
  if (!token) return undefined;
  const session = sessions.get(token);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return session;
}

function toClientUser(email: string): ProfileUser | undefined {
  return getProfileUser(email);
}

function sendReportFile(response: Response, file: ReportFile): void {
  const asciiName = file.filename.replace(/[^\x20-\x7e]/g, "_");
  response.setHeader("Content-Type", file.contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  response.send(file.content);
}

function setSessionCookie(response: Response, token: string, maxAge: number): void {
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge
  });
}

function clearSessionCookie(response: Response): void {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/"
  });
}

function createUserSession(response: Response, email: string, remember: boolean): ProfileUser {
  const maxAge = remember ? rememberedSessionTtlMs : sessionTtlMs;
  const token = crypto.randomBytes(32).toString("hex");
  const profileUser = touchLastLogin(email) ?? getProfileUser(email);
  if (!profileUser) {
    throw new Error("用户资料不存在。");
  }
  sessions.set(token, {
    token,
    email: profileUser.email,
    expiresAt: Date.now() + maxAge
  });
  setSessionCookie(response, token, maxAge);
  return profileUser;
}

function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  const session = getSession(request);
  const user = session ? toClientUser(session.email) : undefined;
  if (!session || !user) {
    response.status(401).json({ error: "请先登录后再使用仓库导览器。" });
    return;
  }
  request.user = user;
  next();
}

function currentUser(request: Request): ProfileUser {
  return (request as AuthenticatedRequest).user as ProfileUser;
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "repo-guide-mvp" });
});

app.post("/api/auth/login", (request, response) => {
  const email = String(request.body?.email ?? "").trim().toLowerCase();
  const password = String(request.body?.password ?? "");
  const remember = Boolean(request.body?.remember);
  const user = demoUsers.find((item) => item.email === email);

  if (!user || user.password !== password) {
    response.status(401).json({ error: "邮箱或密码不正确。" });
    return;
  }

  const profileUser = createUserSession(response, user.email, remember);
  response.json({ user: profileUser });
});

app.post("/api/auth/register", (request, response) => {
  const name = String(request.body?.name ?? "").trim();
  const email = String(request.body?.email ?? "").trim().toLowerCase();
  const password = String(request.body?.password ?? "");

  if (name.length < 2 || name.length > 40) {
    response.status(400).json({ error: "用户名需要为 2 到 40 个字符。" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ error: "请输入有效的邮箱地址。" });
    return;
  }
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    response.status(400).json({ error: "密码至少 8 位，并同时包含字母和数字。" });
    return;
  }
  if (demoUsers.some((item) => item.email === email)) {
    response.status(409).json({ error: "该邮箱已经注册，请直接登录。" });
    return;
  }

  const registeredAt = new Date().toISOString();
  const user: DemoUser = {
    email,
    password,
    name,
    role: "项目分析师",
    team: "个人工作区",
    avatarUrl: "",
    registeredAt,
    lastLoginAt: registeredAt
  };
  demoUsers.push(user);
  const { password: _password, ...profile } = user;
  seedProfileUsers([profile]);
  const profileUser = createUserSession(response, email, true);
  response.status(201).json({ user: profileUser });
});

app.get("/api/auth/me", (request, response) => {
  const session = getSession(request);
  const user = session ? toClientUser(session.email) : undefined;
  if (!session || !user) {
    response.status(401).json({ error: "当前未登录。" });
    return;
  }
  response.json({ user });
});

app.post("/api/auth/logout", (request, response) => {
  const session = getSession(request);
  if (session) {
    sessions.delete(session.token);
  }
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.get("/api/profile", requireAuth, (request, response) => {
  const data = buildPersonalCenterData(currentUser(request).email);
  if (!data) {
    response.status(404).json({ error: "没有找到当前用户资料。" });
    return;
  }
  response.json(data);
});

app.patch("/api/profile", requireAuth, (request, response) => {
  const avatarUrl = typeof request.body?.avatarUrl === "string" ? request.body.avatarUrl.trim() : undefined;
  const isSupportedAvatar = !avatarUrl
    || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(avatarUrl)
    || /^https:\/\//i.test(avatarUrl);
  if (!isSupportedAvatar || (avatarUrl?.length ?? 0) > 1_500_000) {
    response.status(400).json({ error: "头像图片格式无效或文件过大，请重新选择。" });
    return;
  }

  const user = updateProfileUser(currentUser(request).email, {
    name: typeof request.body?.name === "string" ? request.body.name : undefined,
    avatarUrl
  });
  if (!user) {
    response.status(404).json({ error: "没有找到当前用户资料。" });
    return;
  }
  response.json({ user });
});

app.post("/api/analyze", requireAuth, async (request, response) => {
  const controller = new AbortController();
  let finished = false;
  const cancelAnalysis = () => {
    if (!finished && !response.writableEnded) {
      controller.abort();
    }
  };

  request.on("aborted", cancelAnalysis);
  response.on("close", cancelAnalysis);

  try {
    const repoUrl = String(request.body?.repoUrl ?? "");
    const target = parseGitHubUrl(repoUrl);
    const repoPath = await ensureRepoCloned(target, workspaceRoot, controller.signal);
    const { result, files } = await analyzeRepository(repoPath, target, controller.signal);
    const context: RepoContext = { result, repoPath, files };
    contexts.set(result.repoId, context);
    latestRepoId = result.repoId;
    recordAnalysisSuccess(currentUser(request).email, result, generateRunGuide(context));
    finished = true;
    response.json(result);
  } catch (error) {
    finished = true;
    if (response.destroyed || response.writableEnded) {
      return;
    }

    if (isCancelled(error, controller.signal)) {
      response.status(499).json({ error: "分析已取消。" });
      return;
    }

    const repoUrl = String(request.body?.repoUrl ?? "").trim();
    if (repoUrl) {
      recordAnalysisFailure(currentUser(request).email, repoUrl, error instanceof Error ? error.message : "分析失败。");
    }

    response.status(400).json({
      error: error instanceof Error ? error.message : "分析失败。"
    });
  } finally {
    request.off("aborted", cancelAnalysis);
    response.off("close", cancelAnalysis);
  }
});

app.get("/api/repos/:repoId", requireAuth, (request, response) => {
  const context = contexts.get(String(request.params.repoId));
  if (!context) {
    response.status(404).json({ error: "没有找到该仓库的分析结果，请重新分析。" });
    return;
  }
  response.json(context.result);
});

app.get("/api/repositories/:repoId/archive", requireAuth, async (request, response) => {
  const context = contexts.get(String(request.params.repoId));
  if (!context) {
    response.status(404).json({ error: "没有找到该仓库，请重新分析后再下载。" });
    return;
  }

  try {
    const archive = await createRepositoryArchive(context);
    const asciiName = archive.filename.replace(/[^\x20-\x7e]/g, "_");
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`);
    response.sendFile(archive.filePath, (error) => {
      void removeRepositoryArchive(archive.filePath);
      if (error && !response.headersSent) {
        response.status(500).json({ error: "项目压缩包发送失败，请重试。" });
      }
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "项目压缩失败，请稍后重试。"
    });
  }
});

app.get("/api/profile/analysis-records/:recordId", requireAuth, (request, response) => {
  const detail = getAnalysisRecordDetail(currentUser(request).email, String(request.params.recordId));
  if (!detail) {
    response.status(404).json({ error: "没有找到该分析记录。" });
    return;
  }
  response.json(detail);
});

app.delete("/api/profile/analysis-records/:recordId", requireAuth, (request, response) => {
  const deleted = deleteAnalysisRecord(currentUser(request).email, String(request.params.recordId));
  if (!deleted) {
    response.status(404).json({ error: "没有找到该分析记录。" });
    return;
  }
  response.json({ ok: true });
});

app.post("/api/profile/analysis-records/:recordId/favorite", requireAuth, (request, response) => {
  const record = setFavorite(currentUser(request).email, String(request.params.recordId), true);
  if (!record) {
    response.status(404).json({ error: "没有找到该分析记录。" });
    return;
  }
  response.json({ record });
});

app.delete("/api/profile/analysis-records/:recordId/favorite", requireAuth, (request, response) => {
  const record = setFavorite(currentUser(request).email, String(request.params.recordId), false);
  if (!record) {
    response.status(404).json({ error: "没有找到该分析记录。" });
    return;
  }
  response.json({ record });
});

app.get("/api/reports/:recordId/download", requireAuth, async (request, response) => {
  const format = request.query.format === "pdf" ? "pdf" : "markdown";
  const file = await createReportFile(currentUser(request).email, String(request.params.recordId), format);
  if (!file) {
    response.status(404).json({ error: "没有找到可下载的分析报告。" });
    return;
  }
  addDownloadRecord(currentUser(request).email, String(request.params.recordId), format);
  sendReportFile(response, file);
});

app.get("/api/profile/downloads/:downloadId/file", requireAuth, async (request, response) => {
  const download = getDownloadRecord(currentUser(request).email, String(request.params.downloadId));
  if (!download) {
    response.status(404).json({ error: "没有找到该下载记录。" });
    return;
  }
  const file = await createReportFile(currentUser(request).email, download.analysisRecordId, download.format);
  if (!file) {
    response.status(404).json({ error: "原始分析报告不存在，无法再次下载。" });
    return;
  }
  sendReportFile(response, file);
});

app.get("/api/repository/run-guide", requireAuth, (request, response) => {
  try {
    const repoId = typeof request.query.repoId === "string" ? request.query.repoId : latestRepoId;
    const context = repoId ? contexts.get(repoId) : undefined;
    if (!context) {
      response.status(404).json({ error: "请先输入 GitHub 仓库地址并点击分析，系统会自动生成项目运行向导。" });
      return;
    }
    response.json(generateRunGuide(context));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "项目运行向导生成失败，请检查仓库地址或文件结构。"
    });
  }
});

const distPath = path.resolve(workspaceRoot, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(port, "127.0.0.1", () => {
  console.log(`代码仓库智能导览器 API running at http://127.0.0.1:${port}`);
});
