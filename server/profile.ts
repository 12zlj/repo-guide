import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { AnalysisResult, RunGuideResponse, TechItem, TreeNode } from "./types.js";

export type AnalysisStatus = "success" | "failed";
export type ReportFormat = "markdown" | "pdf";

export interface ProfileUser {
  email: string;
  name: string;
  role: string;
  team: string;
  avatarUrl?: string;
  registeredAt: string;
  lastLoginAt: string;
}

export interface AnalysisRecord {
  id: string;
  userEmail: string;
  repoId: string;
  repoName: string;
  repoUrl: string;
  projectTypes: string[];
  techStack: string[];
  analyzedAt: string;
  status: AnalysisStatus;
  favorite: boolean;
  favoriteAt?: string;
  summary: string;
  error?: string;
  analysis?: AnalysisResult;
  runGuide?: RunGuideResponse;
}

export interface DownloadRecord {
  id: string;
  userEmail: string;
  analysisRecordId: string;
  reportName: string;
  repoName: string;
  format: ReportFormat;
  downloadedAt: string;
}

export interface FavoriteRepository {
  id: string;
  analysisRecordId: string;
  repoName: string;
  repoUrl: string;
  projectTypes: string[];
  techStack: string[];
  favoritedAt: string;
}

export interface PersonalCenterData {
  user: ProfileUser;
  analysisRecords: AnalysisRecord[];
  downloadRecords: DownloadRecord[];
  favorites: FavoriteRepository[];
}

export interface ReportFile {
  filename: string;
  contentType: string;
  content: string | Buffer;
}

const users = new Map<string, ProfileUser>();
const analysisRecords = new Map<string, AnalysisRecord[]>();
const downloadRecords = new Map<string, DownloadRecord[]>();

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "repo-report";
}

function summarizeTech(items: TechItem[]): string[] {
  return items.map((item) => item.name).slice(0, 12);
}

function toPublicAnalysisRecord(record: AnalysisRecord): AnalysisRecord {
  const { analysis, runGuide, ...publicRecord } = record;
  return clone(publicRecord);
}

function getUserRecords(userEmail: string): AnalysisRecord[] {
  const records = analysisRecords.get(userEmail);
  if (records) return records;
  const next: AnalysisRecord[] = [];
  analysisRecords.set(userEmail, next);
  return next;
}

function getUserDownloads(userEmail: string): DownloadRecord[] {
  const records = downloadRecords.get(userEmail);
  if (records) return records;
  const next: DownloadRecord[] = [];
  downloadRecords.set(userEmail, next);
  return next;
}

export function seedProfileUsers(seedUsers: ProfileUser[]): void {
  for (const user of seedUsers) {
    users.set(user.email, clone(user));
  }
}

export function getProfileUser(email: string): ProfileUser | undefined {
  const user = users.get(email);
  return user ? clone(user) : undefined;
}

export function touchLastLogin(email: string): ProfileUser | undefined {
  const user = users.get(email);
  if (!user) return undefined;
  user.lastLoginAt = nowIso();
  return clone(user);
}

export function updateProfileUser(email: string, updates: { name?: string; avatarUrl?: string }): ProfileUser | undefined {
  const user = users.get(email);
  if (!user) return undefined;
  if (updates.name?.trim()) {
    user.name = updates.name.trim().slice(0, 40);
  }
  if (typeof updates.avatarUrl === "string") {
    user.avatarUrl = updates.avatarUrl.trim() || undefined;
  }
  return clone(user);
}

export function buildPersonalCenterData(userEmail: string): PersonalCenterData | undefined {
  const user = getProfileUser(userEmail);
  if (!user) return undefined;
  const records = getUserRecords(userEmail).map(toPublicAnalysisRecord);
  const downloads = getUserDownloads(userEmail).map(clone).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  const favorites = records
    .filter((record) => record.favorite)
    .map((record) => ({
      id: `fav_${record.id}`,
      analysisRecordId: record.id,
      repoName: record.repoName,
      repoUrl: record.repoUrl,
      projectTypes: record.projectTypes,
      techStack: record.techStack,
      favoritedAt: record.favoriteAt ?? record.analyzedAt
    }));

  return {
    user,
    analysisRecords: records.sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt)),
    downloadRecords: downloads,
    favorites
  };
}

export function recordAnalysisSuccess(userEmail: string, analysis: AnalysisResult, runGuide: RunGuideResponse): AnalysisRecord {
  const records = getUserRecords(userEmail);
  const existingIndex = records.findIndex((record) => record.repoUrl === analysis.repoUrl);
  const existing = existingIndex >= 0 ? records[existingIndex] : undefined;
  const record: AnalysisRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    userEmail,
    repoId: analysis.repoId,
    repoName: analysis.repoName,
    repoUrl: analysis.repoUrl,
    projectTypes: runGuide.projectTypes,
    techStack: summarizeTech(analysis.techStack),
    analyzedAt: analysis.analyzedAt,
    status: "success",
    favorite: existing?.favorite ?? false,
    favoriteAt: existing?.favoriteAt,
    summary: analysis.summary,
    analysis: clone(analysis),
    runGuide: clone(runGuide)
  };

  if (existingIndex >= 0) {
    records[existingIndex] = record;
  } else {
    records.unshift(record);
  }
  return toPublicAnalysisRecord(record);
}

export function recordAnalysisFailure(userEmail: string, repoUrl: string, error: string): AnalysisRecord {
  const record: AnalysisRecord = {
    id: crypto.randomUUID(),
    userEmail,
    repoId: `failed_${crypto.randomUUID()}`,
    repoName: repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "") || "未知仓库",
    repoUrl,
    projectTypes: [],
    techStack: [],
    analyzedAt: nowIso(),
    status: "failed",
    favorite: false,
    summary: "本次仓库分析失败。",
    error
  };
  getUserRecords(userEmail).unshift(record);
  return toPublicAnalysisRecord(record);
}

export function getAnalysisRecord(userEmail: string, recordId: string): AnalysisRecord | undefined {
  const record = getUserRecords(userEmail).find((item) => item.id === recordId);
  return record ? clone(record) : undefined;
}

export function getAnalysisRecordDetail(userEmail: string, recordId: string): { record: AnalysisRecord; analysis?: AnalysisResult; runGuide?: RunGuideResponse } | undefined {
  const record = getUserRecords(userEmail).find((item) => item.id === recordId);
  if (!record) return undefined;
  return {
    record: toPublicAnalysisRecord(record),
    analysis: record.analysis ? clone(record.analysis) : undefined,
    runGuide: record.runGuide ? clone(record.runGuide) : undefined
  };
}

export function deleteAnalysisRecord(userEmail: string, recordId: string): boolean {
  const records = getUserRecords(userEmail);
  const index = records.findIndex((record) => record.id === recordId);
  if (index === -1) return false;
  records.splice(index, 1);
  downloadRecords.set(
    userEmail,
    getUserDownloads(userEmail).filter((record) => record.analysisRecordId !== recordId)
  );
  return true;
}

export function setFavorite(userEmail: string, recordId: string, favorite: boolean): AnalysisRecord | undefined {
  const record = getUserRecords(userEmail).find((item) => item.id === recordId);
  if (!record) return undefined;
  record.favorite = favorite;
  record.favoriteAt = favorite ? record.favoriteAt ?? nowIso() : undefined;
  return toPublicAnalysisRecord(record);
}

function treeToMarkdown(node: TreeNode, depth = 0): string[] {
  const prefix = depth === 0 ? "" : `${"  ".repeat(Math.max(depth - 1, 0))}- `;
  const marker = node.type === "directory" ? "/" : "";
  const current = `${prefix}${node.name}${marker}`;
  const children = node.children?.flatMap((child) => treeToMarkdown(child, depth + 1)) ?? [];
  return [current, ...children].slice(0, 180);
}

function listOrEmpty(values: string[], emptyText = "未检测到"): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${emptyText}`;
}

function runStepsToMarkdown(steps: { label: string; command: string; cwd?: string; note?: string }[]): string {
  if (!steps.length) return "- 未检测到明确运行步骤";
  return steps
    .map((step, index) => {
      const meta = [step.cwd ? `目录：${step.cwd}` : "", step.note ? `说明：${step.note}` : ""].filter(Boolean).join("；");
      return `${index + 1}. ${step.label}\n   \`${step.command}\`${meta ? `\n   ${meta}` : ""}`;
    })
    .join("\n");
}

function buildMarkdownReport(record: AnalysisRecord): string {
  const analysis = record.analysis;
  const runGuide = record.runGuide;
  return [
    `# ${record.repoName} 仓库分析报告`,
    "",
    `- GitHub 地址：${record.repoUrl}`,
    `- 分析时间：${new Date(record.analyzedAt).toLocaleString("zh-CN")}`,
    `- 分析状态：${record.status === "success" ? "成功" : "失败"}`,
    "",
    "## 项目简介",
    analysis?.summary ?? record.summary,
    "",
    "## 目录结构",
    "```text",
    analysis ? treeToMarkdown(analysis.tree).join("\n") : "未生成目录结构",
    "```",
    "",
    "## 技术栈",
    analysis?.techStack.length
      ? analysis.techStack.map((item) => `- ${item.category}：${item.name}（${item.evidence.join("，")}）`).join("\n")
      : listOrEmpty(record.techStack),
    "",
    "## 核心模块说明",
    analysis?.modules.length
      ? analysis.modules.map((item) => `- ${item.name}（${item.path}）：${item.description}`).join("\n")
      : "- 未识别到核心模块",
    "",
    "## 接口/页面说明",
    analysis?.routes.length
      ? analysis.routes.slice(0, 80).map((item) => `- ${item.method} ${item.route}：${item.file}:${item.line}`).join("\n")
      : "- 未识别到接口",
    analysis?.pages.length
      ? ["", "### 页面", ...analysis.pages.slice(0, 80).map((item) => `- ${item.route}：${item.file}`)].join("\n")
      : "",
    "",
    "## 数据库说明",
    analysis?.database.length
      ? analysis.database.slice(0, 80).map((item) => `- ${item.kind}：${item.name ?? "未命名"}（${item.file}${item.line ? `:${item.line}` : ""}）`).join("\n")
      : "- 未识别到数据库结构",
    "",
    "## 项目运行指南",
    "### 项目类型",
    listOrEmpty(runGuide?.projectTypes ?? record.projectTypes),
    "",
    "### 运行环境",
    listOrEmpty(runGuide?.environments ?? []),
    "",
    "### 数据库文件",
    listOrEmpty(runGuide?.databaseFiles ?? []),
    "",
    "### 配置文件",
    listOrEmpty(runGuide?.configFiles ?? []),
    "",
    "### 后端启动步骤",
    (runGuide?.backendSteps ?? []).length ? runGuide?.backendSteps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "- 未生成后端启动步骤",
    "",
    "### 前端启动步骤",
    (runGuide?.frontendSteps ?? []).length ? runGuide?.frontendSteps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "- 未生成前端启动步骤",
    "",
    "### 注意事项",
    listOrEmpty(runGuide?.warnings ?? []),
    "",
    "## 原始运行步骤",
    runStepsToMarkdown(analysis?.runSteps ?? [])
  ]
    .filter((section) => section !== undefined)
    .join("\n");
}

function firstExistingPath(candidates: string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getReportFonts(): { regular?: string; bold?: string } {
  const windowsRoot = process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows";
  const windowsFonts = path.join(windowsRoot, "Fonts");
  const regular = firstExistingPath([
    path.join(windowsFonts, "Deng.ttf"),
    path.join(windowsFonts, "msyh.ttf"),
    path.join(windowsFonts, "simhei.ttf"),
    path.join(windowsFonts, "simsun.ttc"),
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc"
  ]);
  const bold = firstExistingPath([
    path.join(windowsFonts, "Dengb.ttf"),
    path.join(windowsFonts, "msyhbd.ttf"),
    path.join(windowsFonts, "simhei.ttf"),
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    regular ?? ""
  ]);

  return { regular, bold: bold ?? regular };
}

function cleanMarkdownLine(line: string): string {
  return line.replace(/`/g, "").replace(/\t/g, "  ").trimEnd();
}

function buildPdfReport(record: AnalysisRecord): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 46,
      bufferPages: true,
      info: {
        Title: `${record.repoName} 仓库分析报告`,
        Author: "代码仓库智能导览器"
      }
    });
    const chunks: Buffer[] = [];
    const fonts = getReportFonts();
    const regularFont = fonts.regular ? "report-regular" : "Helvetica";
    const boldFont = fonts.bold ? "report-bold" : "Helvetica-Bold";
    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;

    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    if (fonts.regular) {
      document.registerFont(regularFont, fonts.regular);
    }
    if (fonts.bold) {
      document.registerFont(boldFont, fonts.bold);
    }

    function pageTop(): number {
      return document.page.margins.top;
    }

    function pageBottom(): number {
      return document.page.height - document.page.margins.bottom - 18;
    }

    function isAtPageTop(): boolean {
      return document.y <= pageTop() + 2;
    }

    function ensureSpace(height: number): void {
      const pageContentHeight = pageBottom() - pageTop();
      if (height < pageContentHeight && document.y + height > pageBottom()) {
        document.addPage();
      }
    }

    function addGap(points: number): void {
      if (points <= 0 || isAtPageTop()) return;
      if (document.y + points > pageBottom()) {
        document.addPage();
        return;
      }
      document.y += points;
    }

    function writeBlock(
      text: string,
      options: { size?: number; font?: string; color?: string; lineGap?: number; before?: number; after?: number; indent?: number } = {}
    ) {
      addGap(options.before ?? 0);
      document
        .font(options.font ?? regularFont)
        .fontSize(options.size ?? 10)
        .fillColor(options.color ?? "#243038");

      const indent = options.indent ?? 0;
      const textOptions = {
        width: pageWidth - indent,
        lineGap: options.lineGap ?? 1.6
      };
      const height = document.heightOfString(text, textOptions);
      ensureSpace(height);
      document.text(text, document.page.margins.left + indent, document.y, textOptions);
      addGap(options.after ?? 0);
    }

    let inCodeBlock = false;
    let pendingBlank = false;
    const lines = buildMarkdownReport(record).split(/\r?\n/).slice(0, 760);
    for (const rawLine of lines) {
      const trimmed = cleanMarkdownLine(rawLine);

      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      if (!trimmed) {
        pendingBlank = true;
        continue;
      }

      if (trimmed.startsWith("# ")) {
        pendingBlank = false;
        writeBlock(trimmed.slice(2), { size: 18, font: boldFont, color: "#182126", lineGap: 2, before: 2, after: 7 });
        continue;
      }

      if (trimmed.startsWith("## ")) {
        pendingBlank = false;
        writeBlock(trimmed.slice(3), { size: 14, font: boldFont, color: "#2f6690", lineGap: 2, before: 10, after: 5 });
        continue;
      }

      if (trimmed.startsWith("### ")) {
        pendingBlank = false;
        writeBlock(trimmed.slice(4), { size: 11.5, font: boldFont, color: "#0f766e", lineGap: 1.5, before: 6, after: 3 });
        continue;
      }

      if (pendingBlank) {
        addGap(4);
        pendingBlank = false;
      }

      if (inCodeBlock) {
        writeBlock(trimmed, { size: 9, color: "#425f77", lineGap: 1, after: 1 });
        continue;
      }

      if (trimmed.startsWith("- ")) {
        writeBlock(`• ${trimmed.slice(2)}`, { size: 10, lineGap: 1.4, after: 2, indent: 8 });
        continue;
      }

      writeBlock(trimmed, { size: 10.2, lineGap: 1.6, after: 3 });
    }

    const pageRange = document.bufferedPageRange();
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      document.switchToPage(pageIndex);
      const footerY = document.page.height - document.page.margins.bottom - 10;
      document
        .font(regularFont)
        .fontSize(8)
        .fillColor("#64717a")
        .text(`${pageIndex + 1} / ${pageRange.count}`, document.page.margins.left, footerY, {
          width: pageWidth,
          align: "right",
          lineBreak: false
        });
    }

    document.end();
  });
}

export async function createReportFile(userEmail: string, recordId: string, format: ReportFormat): Promise<ReportFile | undefined> {
  const record = getUserRecords(userEmail).find((item) => item.id === recordId);
  if (!record || record.status !== "success") return undefined;
  const baseName = `${safeFileName(record.repoName)}-analysis-report`;
  if (format === "pdf") {
    return {
      filename: `${baseName}.pdf`,
      contentType: "application/pdf",
      content: await buildPdfReport(record)
    };
  }
  return {
    filename: `${baseName}.md`,
    contentType: "text/markdown; charset=utf-8",
    content: buildMarkdownReport(record)
  };
}

export function addDownloadRecord(userEmail: string, recordId: string, format: ReportFormat): DownloadRecord | undefined {
  const record = getUserRecords(userEmail).find((item) => item.id === recordId);
  if (!record || record.status !== "success") return undefined;
  const download: DownloadRecord = {
    id: crypto.randomUUID(),
    userEmail,
    analysisRecordId: record.id,
    reportName: `${record.repoName} 分析报告`,
    repoName: record.repoName,
    format,
    downloadedAt: nowIso()
  };
  getUserDownloads(userEmail).unshift(download);
  return clone(download);
}

export function getDownloadRecord(userEmail: string, downloadId: string): DownloadRecord | undefined {
  const record = getUserDownloads(userEmail).find((item) => item.id === downloadId);
  return record ? clone(record) : undefined;
}
