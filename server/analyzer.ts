import fs from "node:fs/promises";
import path from "node:path";
import type {
  AnalysisResult,
  DatabaseInfo,
  FileReference,
  IndexedFile,
  ModuleSummary,
  PageInfo,
  RouteInfo,
  RunStep,
  TechItem,
  TreeNode
} from "./types.js";
import type { RepoTarget } from "./git.js";

const MAX_TREE_DEPTH = 7;
const MAX_TREE_ENTRIES_PER_DIR = 80;
const MAX_SCAN_FILES = 2500;
const MAX_FILE_BYTES = 512 * 1024;

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".gradle",
  ".mvn",
  ".idea",
  ".vscode",
  ".repos",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  "env",
  "Pods",
  "DerivedData"
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".php",
  ".rb",
  ".cs",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".gradle",
  ".sql",
  ".prisma",
  ".graphql",
  ".gql",
  ".env",
  ".example"
]);

const IMPORTANT_FILES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "README",
  "README.md",
  "readme.md"
]);

interface ScanState {
  files: IndexedFile[];
  fileCount: number;
  dirCount: number;
  totalBytes: number;
}

function cancelledError(): Error {
  return new Error("Analysis cancelled.");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw cancelledError();
  }
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function fileNameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function directoryOf(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "." : filePath.slice(0, index);
}

function shouldIgnoreDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith(".git");
}

function isScannableFile(name: string): boolean {
  if (IMPORTANT_FILES.has(name)) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(name));
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

async function safeReadDir(targetPath: string) {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(targetPath: string) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return undefined;
  }
}

function sortEntries<T extends { name: string; isDirectory?: () => boolean }>(entries: T[]): T[] {
  return entries.sort((a, b) => {
    const aDir = typeof a.isDirectory === "function" && a.isDirectory();
    const bDir = typeof b.isDirectory === "function" && b.isDirectory();
    if (aDir !== bDir) {
      return aDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

async function buildTree(rootPath: string, relativePath = "", depth = 0, signal?: AbortSignal): Promise<TreeNode> {
  throwIfAborted(signal);

  const name = relativePath ? path.basename(relativePath) : path.basename(rootPath);
  const nodePath = relativePath ? toPosix(relativePath) : ".";
  const node: TreeNode = { name, path: nodePath, type: "directory", children: [] };

  if (depth >= MAX_TREE_DEPTH) {
    node.truncated = true;
    return node;
  }

  const absolutePath = path.join(rootPath, relativePath);
  const entries = sortEntries(await safeReadDir(absolutePath)).filter((entry) => {
    if (entry.isDirectory()) {
      return !shouldIgnoreDir(entry.name);
    }
    return true;
  });

  const shownEntries = entries.slice(0, MAX_TREE_ENTRIES_PER_DIR);
  node.truncated = entries.length > shownEntries.length;

  for (const entry of shownEntries) {
    throwIfAborted(signal);

    const childRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      node.children?.push(await buildTree(rootPath, childRelative, depth + 1, signal));
    } else {
      node.children?.push({
        name: entry.name,
        path: toPosix(childRelative),
        type: "file"
      });
    }
  }

  return node;
}

async function scanRepository(rootPath: string, signal?: AbortSignal): Promise<ScanState> {
  const state: ScanState = { files: [], fileCount: 0, dirCount: 0, totalBytes: 0 };

  async function walk(relativePath = ""): Promise<void> {
    throwIfAborted(signal);

    const absolutePath = path.join(rootPath, relativePath);
    const entries = await safeReadDir(absolutePath);
    const fileEntries = entries
      .filter((entry) => entry.isFile())
      .sort((a, b) => {
        const importantA = IMPORTANT_FILES.has(a.name) ? 0 : 1;
        const importantB = IMPORTANT_FILES.has(b.name) ? 0 : 1;
        if (importantA !== importantB) return importantA - importantB;
        return a.name.localeCompare(b.name);
      });
    const directoryEntries = entries
      .filter((entry) => entry.isDirectory() && !shouldIgnoreDir(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of [...fileEntries, ...directoryEntries]) {
      throwIfAborted(signal);

      const childRelative = path.join(relativePath, entry.name);
      const childAbsolute = path.join(rootPath, childRelative);

      if (entry.isDirectory()) {
        state.dirCount += 1;
        await walk(childRelative);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      state.fileCount += 1;
      const stat = await safeStat(childAbsolute);
      if (stat) {
        state.totalBytes += stat.size;
      }

      if (state.files.length >= MAX_SCAN_FILES || !isScannableFile(entry.name) || !stat || stat.size > MAX_FILE_BYTES) {
        continue;
      }

      try {
        const buffer = await fs.readFile(childAbsolute);
        if (isProbablyBinary(buffer)) {
          continue;
        }
        const content = buffer.toString("utf8");
        state.files.push({
          path: toPosix(childRelative),
          absolutePath: childAbsolute,
          content,
          lines: content.split(/\r?\n/),
          size: stat.size
        });
      } catch {
        // Permission and encoding surprises should not stop an analysis run.
      }
    }
  }

  await walk();
  return state;
}

function parseJson(content: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

function scriptsOf(packageJson: Record<string, unknown>): Record<string, string> {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter(([, value]) => typeof value === "string")
  ) as Record<string, string>;
}

function detectTech(files: IndexedFile[]): TechItem[] {
  const tech = new Map<string, TechItem>();
  const add = (name: string, category: string, evidence: string) => {
    const existing = tech.get(name);
    if (existing) {
      if (!existing.evidence.includes(evidence) && existing.evidence.length < 4) {
        existing.evidence.push(evidence);
      }
      return;
    }
    tech.set(name, { name, category, evidence: [evidence] });
  };

  for (const file of files) {
    const lowerPath = file.path.toLowerCase();
    const lowerContent = file.content.toLowerCase();

    if (fileNameOf(file.path) === "package.json") {
      const parsed = parseJson(file.content);
      const dependencies = [
        ...objectKeys(parsed?.dependencies),
        ...objectKeys(parsed?.devDependencies),
        ...objectKeys(parsed?.peerDependencies)
      ];
      const depSet = new Set(dependencies);
      const evidenceBase = `${file.path} 依赖`;

      if (depSet.has("react")) add("React", "前端", evidenceBase);
      if (depSet.has("vue")) add("Vue", "前端", evidenceBase);
      if (depSet.has("@angular/core")) add("Angular", "前端", evidenceBase);
      if (depSet.has("next")) add("Next.js", "全栈框架", evidenceBase);
      if (depSet.has("vite")) add("Vite", "构建工具", evidenceBase);
      if (depSet.has("express")) add("Express", "后端", evidenceBase);
      if (depSet.has("@nestjs/core")) add("NestJS", "后端", evidenceBase);
      if (depSet.has("fastify")) add("Fastify", "后端", evidenceBase);
      if (depSet.has("koa")) add("Koa", "后端", evidenceBase);
      if (depSet.has("typescript")) add("TypeScript", "语言", evidenceBase);
      if (depSet.has("tailwindcss")) add("Tailwind CSS", "样式", evidenceBase);
      if (depSet.has("prisma")) add("Prisma", "数据库 ORM", evidenceBase);
      if (depSet.has("typeorm")) add("TypeORM", "数据库 ORM", evidenceBase);
      if (depSet.has("sequelize")) add("Sequelize", "数据库 ORM", evidenceBase);
      if (depSet.has("mongoose")) add("Mongoose", "数据库 ORM", evidenceBase);
      if (depSet.has("electron")) add("Electron", "桌面端", evidenceBase);
    }

    if (fileNameOf(file.path) === "pom.xml" && lowerContent.includes("spring-boot")) {
      add("Spring Boot", "后端", `${file.path} 包含 spring-boot`);
      add("Maven", "构建工具", file.path);
    }
    if (fileNameOf(file.path).includes("build.gradle")) {
      add("Gradle", "构建工具", file.path);
      if (lowerContent.includes("org.springframework.boot")) add("Spring Boot", "后端", file.path);
    }
    if (fileNameOf(file.path) === "requirements.txt" || fileNameOf(file.path) === "pyproject.toml") {
      if (lowerContent.includes("fastapi")) add("FastAPI", "后端", file.path);
      if (lowerContent.includes("flask")) add("Flask", "后端", file.path);
      if (lowerContent.includes("django")) add("Django", "后端", file.path);
      if (lowerContent.includes("sqlalchemy")) add("SQLAlchemy", "数据库 ORM", file.path);
    }
    if (lowerPath.endsWith(".py") && lowerContent.includes("from fastapi")) add("FastAPI", "后端", file.path);
    if (lowerPath.endsWith(".vue")) add("Vue", "前端", `${file.path} 文件类型`);
    if (lowerPath.endsWith(".tsx") || lowerPath.endsWith(".jsx")) {
      if (lowerContent.includes("from \"react\"") || lowerContent.includes("from 'react'") || lowerContent.includes("jsx")) {
        add("React", "前端", `${file.path} JSX/TSX`);
      }
    }
    if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".tsx")) add("TypeScript", "语言", `${file.path} 文件类型`);
    if (fileNameOf(file.path).toLowerCase().startsWith("dockerfile") || lowerPath.includes("docker-compose")) {
      add("Docker", "部署", file.path);
    }
    if (lowerPath.endsWith(".prisma")) add("Prisma", "数据库 ORM", file.path);
    const canContainDatabaseConfig =
      !/(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|readme(?:\.md|\.mdx)?)$/i.test(lowerPath)
      && /\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|php|rb|cs|json|ya?ml|toml|xml|gradle|sql|prisma|env|properties)$/i.test(lowerPath);
    if (canContainDatabaseConfig) {
      if (lowerContent.includes("postgres")) add("PostgreSQL", "数据库", file.path);
      if (lowerContent.includes("mysql")) add("MySQL", "数据库", file.path);
      if (lowerContent.includes("sqlite")) add("SQLite", "数据库", file.path);
      if (lowerContent.includes("mongodb") || lowerContent.includes("mongoose")) add("MongoDB", "数据库", file.path);
    }
  }

  const priority = ["前端", "全栈框架", "后端", "数据库 ORM", "数据库", "语言", "构建工具", "部署"];
  return [...tech.values()].sort((a, b) => {
    const aIndex = priority.indexOf(a.category);
    const bIndex = priority.indexOf(b.category);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.name.localeCompare(b.name);
  });
}

function hasFile(files: IndexedFile[], relativePath: string): boolean {
  return files.some((file) => file.path === relativePath);
}

function commandForPackageManager(files: IndexedFile[], packageDir: string, scriptName: string): string {
  const prefix = packageDir === "." ? "" : `${packageDir}/`;
  if (hasFile(files, `${prefix}pnpm-lock.yaml`)) return `pnpm ${scriptName}`;
  if (hasFile(files, `${prefix}yarn.lock`)) return `yarn ${scriptName}`;
  return scriptName === "install" ? "npm install" : `npm run ${scriptName}`;
}

function inferFastApiEntrypoint(files: IndexedFile[], packageDir: string): string {
  const candidates = files.filter((file) => {
    const inDir = packageDir === "." || file.path.startsWith(`${packageDir}/`);
    return inDir && file.path.endsWith(".py") && /FastAPI\s*\(/.test(file.content);
  });
  const first = candidates[0];
  if (!first) return "main:app";
  const localPath = packageDir === "." ? first.path : first.path.slice(packageDir.length + 1);
  return localPath.replace(/\.py$/, "").split("/").join(".") + ":app";
}

function inferRunSteps(files: IndexedFile[], techStack: TechItem[]): RunStep[] {
  const steps: RunStep[] = [];
  const packageFiles = files.filter((file) => file.path.endsWith("package.json"));

  for (const packageFile of packageFiles.slice(0, 3)) {
    const parsed = parseJson(packageFile.content);
    if (!parsed) continue;
    const packageDir = directoryOf(packageFile.path);
    const cwd = packageDir === "." ? undefined : packageDir;
    const scripts = scriptsOf(parsed);

    steps.push({
      label: cwd ? `安装 ${cwd} 依赖` : "安装前端/Node 依赖",
      command: commandForPackageManager(files, packageDir, "install"),
      cwd
    });

    const preferredScript = ["dev", "start", "serve"].find((name) => scripts[name]);
    if (preferredScript) {
      steps.push({
        label: `启动 ${cwd ?? "项目"}`,
        command: commandForPackageManager(files, packageDir, preferredScript),
        cwd,
        note: scripts[preferredScript]
      });
    }

    if (scripts.build) {
      steps.push({
        label: `构建 ${cwd ?? "项目"}`,
        command: commandForPackageManager(files, packageDir, "build"),
        cwd,
        note: scripts.build
      });
    }
  }

  const compose = files.find((file) => ["docker-compose.yml", "docker-compose.yaml"].includes(fileNameOf(file.path)));
  if (compose) {
    steps.push({
      label: "使用 Docker Compose 启动",
      command: "docker compose up --build",
      cwd: directoryOf(compose.path),
      note: compose.path
    });
  }

  const pom = files.find((file) => file.path.endsWith("pom.xml") && file.content.toLowerCase().includes("spring-boot"));
  if (pom) {
    steps.push({
      label: "启动 Spring Boot",
      command: "mvn spring-boot:run",
      cwd: directoryOf(pom.path)
    });
  }

  const gradle = files.find((file) => file.path.endsWith("build.gradle") && file.content.includes("org.springframework.boot"));
  if (gradle) {
    steps.push({
      label: "启动 Gradle Spring Boot",
      command: ".\\gradlew bootRun",
      cwd: directoryOf(gradle.path)
    });
  }

  const requirements = files.find((file) => file.path.endsWith("requirements.txt"));
  const hasFastApi = techStack.some((item) => item.name === "FastAPI");
  if (requirements) {
    const cwd = directoryOf(requirements.path);
    steps.push({
      label: "安装 Python 依赖",
      command: "pip install -r requirements.txt",
      cwd
    });
    if (hasFastApi) {
      steps.push({
        label: "启动 FastAPI",
        command: `uvicorn ${inferFastApiEntrypoint(files, cwd)} --reload`,
        cwd
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      label: "查看 README",
      command: "阅读 README.md 中的启动说明",
      note: "没有识别到标准启动脚本，建议先查看 README 和配置文件。"
    });
  }

  return steps;
}

function describeModule(name: string, pathName: string, techStack: TechItem[]): Pick<ModuleSummary, "kind" | "description"> {
  const lower = name.toLowerCase();
  const techNames = new Set(techStack.map((item) => item.name));

  if (["src", "app"].includes(lower)) {
    return {
      kind: "源码",
      description: techNames.has("React") || techNames.has("Vue") || techNames.has("Next.js")
        ? "主要应用源码，通常包含页面、组件、状态和业务逻辑。"
        : "主要应用源码，通常包含业务入口和核心实现。"
    };
  }
  if (["server", "backend", "api"].includes(lower)) {
    return { kind: "后端", description: "后端服务和 API 实现，通常包含路由、控制器和业务服务。" };
  }
  if (["routes", "router", "controllers", "controller"].includes(lower)) {
    return { kind: "接口", description: "接口路由或控制器定义，是定位 HTTP 行为的优先入口。" };
  }
  if (["components", "views", "pages"].includes(lower)) {
    return { kind: "页面/组件", description: "前端页面和可复用 UI 组件。" };
  }
  if (["models", "entities", "entity", "schema", "migrations", "prisma", "db", "database"].includes(lower)) {
    return { kind: "数据", description: "数据库模型、迁移或持久化访问相关代码。" };
  }
  if (["config", "configs"].includes(lower)) {
    return { kind: "配置", description: "项目配置、环境配置或构建配置。" };
  }
  if (["test", "tests", "__tests__", "spec"].includes(lower)) {
    return { kind: "测试", description: "自动化测试、测试夹具或用例集合。" };
  }
  if (["docs", "documentation"].includes(lower)) {
    return { kind: "文档", description: "项目文档、使用说明或设计资料。" };
  }
  if (pathName.includes("infra") || lower.includes("deploy")) {
    return { kind: "部署", description: "部署、基础设施或运行环境相关配置。" };
  }
  return { kind: "模块", description: "项目中的功能目录，可结合关键文件继续深入查看。" };
}

function inferModules(files: IndexedFile[], techStack: TechItem[]): ModuleSummary[] {
  const groups = new Map<string, IndexedFile[]>();
  for (const file of files) {
    const firstSegment = file.path.split("/")[0] || ".";
    if (firstSegment.startsWith(".")) continue;
    if (file.path === firstSegment) continue;
    const list = groups.get(firstSegment) ?? [];
    list.push(file);
    groups.set(firstSegment, list);
  }

  const importance = (file: IndexedFile) => {
    const lower = file.path.toLowerCase();
    if (/readme|package\.json|main\.|index\.|app\.|server\.|router|route|controller|schema|model|entity/.test(lower)) {
      return 0;
    }
    return 1;
  };

  const modules = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([name, group]) => {
      const keyFiles = [...group]
        .sort((a, b) => importance(a) - importance(b) || a.path.localeCompare(b.path))
        .slice(0, 6)
        .map((file) => file.path);
      const description = describeModule(name, name, techStack);
      return {
        name,
        path: name,
        kind: description.kind,
        description: `${description.description} 已扫描 ${group.length} 个相关文本文件。`,
        keyFiles
      };
    });

  const rootKeyFiles = files
    .filter((file) => !file.path.includes("/"))
    .filter((file) => /readme|package\.json|pom\.xml|build\.gradle|requirements\.txt|pyproject\.toml|dockerfile|vite\.config|tsconfig/.test(file.path.toLowerCase()))
    .slice(0, 8)
    .map((file) => file.path);

  if (rootKeyFiles.length > 0) {
    modules.unshift({
      name: "项目根目录",
      path: ".",
      kind: "入口/配置",
      description: "项目级说明、依赖、脚本和构建配置通常集中在这里。",
      keyFiles: rootKeyFiles
    });
  }

  return modules.slice(0, 11);
}

function lineNumberForIndex(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function joinRoutePath(basePath: string, childPath: string): string {
  const normalizedBase = basePath === "/" ? "" : basePath;
  const normalizedChild = childPath === "/" ? "" : childPath;
  return `/${normalizedBase}/${normalizedChild}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function routeGroup(route: string, filePath: string): string {
  const value = `${route} ${filePath}`.toLowerCase();
  if (/auth|login|register|token|session|password/.test(value)) return "认证与账号";
  if (/borrow|return|renew|reservation/.test(value)) return "借阅与预约";
  if (/book|library|catalog/.test(value)) return "图书管理";
  if (/user|reader|member|profile/.test(value)) return "用户管理";
  if (/admin|manage|system/.test(value)) return "后台管理";
  if (/report|stat|dashboard|analytics/.test(value)) return "统计与报表";
  if (/upload|file|export|download/.test(value)) return "文件与导出";
  return "其他接口";
}

function routeDescription(method: string, route: string): string {
  const value = route.toLowerCase();
  if (/login/.test(value)) return "提交登录信息并创建用户会话";
  if (/register|sign-?up/.test(value)) return "创建新的用户账号";
  if (/logout/.test(value)) return "退出当前登录会话";
  if (/profile|\/me\b/.test(value)) return method === "GET" ? "获取当前用户资料" : "更新当前用户资料";
  if (/books?/.test(value)) return method === "GET" ? "查询图书或馆藏信息" : method === "DELETE" ? "删除图书记录" : "新增或修改图书信息";
  if (/borrow/.test(value)) return "处理图书借阅业务";
  if (/return/.test(value)) return "处理图书归还业务";
  if (/renew/.test(value)) return "处理图书续借业务";
  if (/reservation|reserve/.test(value)) return "处理图书预约业务";
  if (/users?|readers?|members?/.test(value)) return method === "GET" ? "查询用户或读者信息" : "维护用户或读者信息";
  if (/export|download/.test(value)) return "生成或下载业务数据";
  return method === "GET" ? "读取相关业务数据" : method === "DELETE" ? "删除相关业务数据" : "提交或更新相关业务数据";
}

function findRoutes(files: IndexedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const add = (method: string, route: string, file: IndexedFile, line: number, handler?: string) => {
    if (!route || routes.length >= 200) return;
    const normalizedMethod = method.toUpperCase();
    routes.push({
      method: normalizedMethod,
      route,
      file: file.path,
      line,
      handler,
      group: routeGroup(route, file.path),
      description: routeDescription(normalizedMethod, route)
    });
  };

  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt)$/.test(lower)) continue;

    const jsRegex = /\b(app|router)\s*\.\s*(get|post|put|patch|delete|options|head|use)\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*([A-Za-z0-9_$]+))?/g;
    for (const match of file.content.matchAll(jsRegex)) {
      add(match[2], match[3], file, lineNumberForIndex(file.content, match.index ?? 0), match[4]);
    }

    const fastApiRegex = /@\s*(?:app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of file.content.matchAll(fastApiRegex)) {
      add(match[1], match[2], file, lineNumberForIndex(file.content, match.index ?? 0));
    }

    if (lower.endsWith(".java") || lower.endsWith(".kt")) {
      const classIndex = file.content.search(/\b(class|interface)\s+[A-Za-z0-9_]+/);
      const classHeader = classIndex >= 0 ? file.content.slice(0, classIndex) : "";
      const basePathMatches = [...classHeader.matchAll(/@RequestMapping\s*\(\s*(?:(?:value|path)\s*=\s*)?["']([^"']+)["']/g)];
      const basePath = basePathMatches.at(-1)?.[1] ?? "";
      const methodContent = classIndex >= 0 ? file.content.slice(classIndex) : file.content;
      const methodOffset = classIndex >= 0 ? classIndex : 0;
      const springRegex = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([\s\S]*?)\))?\s*(?:public|private|protected|fun|suspend|static|final|\s)+/g;
      for (const match of methodContent.matchAll(springRegex)) {
        const annotation = match[1];
        const argumentsText = match[2] ?? "";
        const explicitPath =
          argumentsText.match(/(?:value|path)\s*=\s*["']([^"']+)["']/)?.[1]
          ?? argumentsText.match(/^\s*["']([^"']+)["']/)?.[1]
          ?? "";
        const requestMethod = argumentsText.match(/RequestMethod\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)/)?.[1];
        const methodName = annotation === "RequestMapping" ? requestMethod ?? "ALL" : annotation.replace("Mapping", "").toUpperCase();
        const fullRoute = joinRoutePath(basePath, explicitPath);
        add(methodName, fullRoute, file, lineNumberForIndex(file.content, methodOffset + (match.index ?? 0)));
      }
    }
  }

  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.method}:${route.route}:${route.file}:${route.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeFromFile(filePath: string): string {
  let route = filePath
    .replace(/^src\//, "")
    .replace(/^app\//, "")
    .replace(/^pages\//, "")
    .replace(/^views\//, "")
    .replace(/\.(tsx|ts|jsx|js|vue|svelte)$/i, "")
    .replace(/\/page$/i, "")
    .replace(/\/index$/i, "")
    .replace(/\[(.+?)\]/g, ":$1")
    .replace(/\\/g, "/");

  route = route
    .split("/")
    .filter((segment) => !["pages", "views"].includes(segment.toLowerCase()))
    .join("/");

  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function findPages(files: IndexedFile[], techStack: TechItem[]): PageInfo[] {
  const pages: PageInfo[] = [];
  const hasReact = techStack.some((item) => item.name === "React" || item.name === "Next.js");
  const hasVue = techStack.some((item) => item.name === "Vue");

  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (
      /^app\/.*\/?page\.(tsx|jsx|ts|js)$/.test(lower) ||
      /^pages\/.*\.(tsx|jsx|ts|js)$/.test(lower) ||
      /^src\/pages\/.*\.(tsx|jsx|ts|js|vue|svelte)$/.test(lower) ||
      /^src\/views\/.*\.(tsx|jsx|ts|js|vue|svelte)$/.test(lower)
    ) {
      pages.push({
        route: routeFromFile(file.path),
        file: file.path,
        framework: lower.endsWith(".vue") ? "Vue" : hasReact ? "React/Next" : hasVue ? "Vue" : undefined,
        name: fileNameOf(file.path).replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
        description: "前端路由或页面组件，可作为用户访问入口"
      });
    }

    if (lower.endsWith(".html") && !/\/(?:node_modules|dist|build|coverage)\//.test(lower)) {
      const fileName = fileNameOf(file.path);
      const isIndex = /^index\.html$/i.test(fileName);
      const htmlRoute = isIndex ? "/" : `/${fileName.replace(/\.html$/i, "")}`;
      pages.push({
        route: htmlRoute,
        file: file.path,
        framework: "HTML",
        name: isIndex ? "首页" : fileName.replace(/\.html$/i, "").replace(/[-_]/g, " "),
        description: isIndex ? "项目的默认网页入口，可直接由浏览器或静态服务器打开" : "独立 HTML 页面入口"
      });
    }
  }

  for (const file of files) {
    if (!/(router|routes)\.(ts|js|tsx|jsx)$/.test(file.path.toLowerCase())) continue;
    const routeRegex = /\bpath\s*:\s*["'`]([^"'`]+)["'`]/g;
    for (const match of file.content.matchAll(routeRegex)) {
      pages.push({
        route: match[1],
        file: file.path,
        framework: hasVue ? "Vue Router" : "Router config",
        name: match[1] === "/" ? "首页" : match[1].split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ") ?? "页面",
        description: "由前端路由配置声明的页面入口"
      });
    }
  }

  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = `${page.route}:${page.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
}

function databaseObjectDescription(name: string, kind: string): string {
  const value = name.toLowerCase();
  if (/^book$|books|catalog/.test(value)) return "保存图书、馆藏数量、分类和存放位置等基础信息";
  if (/student|reader|member|user/.test(value)) return "保存读者或用户账号、身份、联系方式和借阅权限";
  if (/borrow|loan|checkout/.test(value)) return "记录图书借出、应还、归还、续借和逾期状态";
  if (/reservation|reserve/.test(value)) return "记录读者预约图书、排队顺序和通知状态";
  if (/fine|penalty/.test(value)) return "记录逾期产生的罚款金额、支付状态和关联借阅记录";
  if (/notification|message/.test(value)) return "保存站内通知、提醒内容、发送渠道和阅读状态";
  if (/operation_log|audit|log/.test(value)) return "记录关键操作和审计信息，便于追踪系统行为";
  if (/setting|config/.test(value)) return "保存可动态调整的系统配置项";
  if (/role|permission/.test(value)) return "保存角色、权限或访问控制配置";
  return kind.toLowerCase().includes("model") ? "应用中的数据模型定义" : "保存项目业务数据";
}

function splitSqlDefinitions(body: string): string[] {
  const definitions: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";

  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) definitions.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) definitions.push(current.trim());
  return definitions;
}

function parseSqlTable(file: IndexedFile, match: RegExpMatchArray): DatabaseInfo {
  const tableName = match[1];
  const body = match[2];
  const definitions = splitSqlDefinitions(body);
  const primaryKeys = new Set<string>();
  const foreignKeys: NonNullable<DatabaseInfo["foreignKeys"]> = [];

  for (const definition of definitions) {
    const tablePrimaryKey = definition.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (tablePrimaryKey) {
      tablePrimaryKey[1]
        .split(",")
        .map((value) => value.replace(/["`[\]\s]/g, ""))
        .filter(Boolean)
        .forEach((value) => primaryKeys.add(value));
    }
    const foreignKey = definition.match(/FOREIGN\s+KEY\s*\(\s*["`[]?([A-Za-z0-9_]+)["`\]]?\s*\)\s+REFERENCES\s+["`[]?([A-Za-z0-9_.-]+)["`\]]?\s*\(\s*["`[]?([A-Za-z0-9_]+)["`\]]?\s*\)/i);
    if (foreignKey) {
      foreignKeys.push({
        column: foreignKey[1],
        referencedTable: foreignKey[2],
        referencedColumn: foreignKey[3]
      });
    }
  }

  const columns = definitions.flatMap((definition) => {
    if (/^(?:CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|KEY|INDEX|CHECK)\b/i.test(definition)) return [];
    const columnMatch = definition.match(
      /^["`[]?([A-Za-z0-9_]+)["`\]]?\s+([A-Za-z]+(?:\s+(?:PRECISION|VARYING))?(?:\s*\([^)]*\))?)/i
    );
    if (!columnMatch) return [];
    const columnName = columnMatch[1];
    const inlinePrimaryKey = /\bPRIMARY\s+KEY\b/i.test(definition);
    if (inlinePrimaryKey) primaryKeys.add(columnName);
    return [{
      name: columnName,
      type: columnMatch[2].replace(/\s+/g, " ").toUpperCase(),
      nullable: !/\bNOT\s+NULL\b/i.test(definition) && !inlinePrimaryKey,
      primaryKey: inlinePrimaryKey
    }];
  });

  for (const column of columns) {
    column.primaryKey = primaryKeys.has(column.name);
  }

  return {
    kind: "SQL table",
    file: file.path,
    line: lineNumberForIndex(file.content, match.index ?? 0),
    name: tableName,
    description: databaseObjectDescription(tableName, "SQL table"),
    columns,
    primaryKey: [...primaryKeys],
    foreignKeys
  };
}

function findDatabase(files: IndexedFile[]): DatabaseInfo[] {
  const database: DatabaseInfo[] = [];
  const add = (entry: DatabaseInfo) => {
    if (database.length >= 200) return;
    database.push(entry);
  };

  for (const file of files) {
    const lower = file.path.toLowerCase();

    if (lower.endsWith("schema.prisma")) {
      for (const match of file.content.matchAll(/^model\s+([A-Za-z0-9_]+)/gm)) {
        add({ kind: "Prisma model", file: file.path, line: lineNumberForIndex(file.content, match.index ?? 0), name: match[1] });
      }
      continue;
    }

    if (lower.endsWith(".sql") || lower.includes("migration")) {
      const tableRegex = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`[]?([A-Za-z0-9_.-]+)["`\]]?\s*\(([\s\S]*?)\)\s*(?:engine\b[^;]*)?;/gi;
      let tableFound = false;
      for (const match of file.content.matchAll(tableRegex)) {
        tableFound = true;
        add(parseSqlTable(file, match));
      }
      if (!tableFound && lower.includes("migration")) {
        add({ kind: "Migration", file: file.path });
      }
      continue;
    }

    if (/(model|entity|schema)\.(ts|js|py|java|kt)$/.test(lower) || /(models|entities)\//.test(lower)) {
      const entityMatch = file.content.match(/@Entity\s*(?:\(\s*["']([^"']+)["']\s*\))?|class\s+([A-Za-z0-9_]+)|model\s+([A-Za-z0-9_]+)/);
      add({
        kind: lower.endsWith(".py") ? "Model" : "Entity/Model",
        file: file.path,
        line: entityMatch?.index ? lineNumberForIndex(file.content, entityMatch.index) : undefined,
        name: entityMatch?.[1] ?? entityMatch?.[2] ?? entityMatch?.[3],
        description: databaseObjectDescription(entityMatch?.[1] ?? entityMatch?.[2] ?? entityMatch?.[3] ?? "model", "Entity/Model")
      });
      continue;
    }

    if (lower.endsWith("models.py")) {
      for (const match of file.content.matchAll(/^class\s+([A-Za-z0-9_]+)\s*\(/gm)) {
        add({
          kind: "Django/SQLAlchemy model",
          file: file.path,
          line: lineNumberForIndex(file.content, match.index ?? 0),
          name: match[1],
          description: databaseObjectDescription(match[1], "Django/SQLAlchemy model")
        });
      }
    }
  }

  return database;
}

function findReadme(files: IndexedFile[]): IndexedFile | undefined {
  return files
    .filter((file) => /^readme(\.md|\.mdx)?$/i.test(fileNameOf(file.path)))
    .sort((a, b) => {
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return a.path.localeCompare(b.path);
    })[0];
}

function summaryFromReadme(readme: IndexedFile | undefined): string {
  if (!readme) return "";
  const paragraphs = readme.content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) =>
      paragraph
        .replace(/<[^>]+>/g, " ")
        .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
        .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/[*_`>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(
      (paragraph) =>
        paragraph.length >= 40
        && paragraph.length <= 700
        && !/shields\.io|badge|build status|codecov|license|sponsor|documentation\s*\|/i.test(paragraph)
        && !/^(table of contents|contents|installation|getting started)$/i.test(paragraph)
    );
  return paragraphs[0]?.slice(0, 420) ?? "";
}

function projectDescriptionFromConfig(files: IndexedFile[]): string {
  for (const file of files) {
    const name = fileNameOf(file.path).toLowerCase();
    if (name === "package.json") {
      const parsed = parseJson(file.content);
      if (typeof parsed?.description === "string" && parsed.description.trim()) {
        return parsed.description.trim();
      }
    }
    if (name === "pyproject.toml") {
      const description = file.content.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1];
      if (description) return description.trim();
    }
    if (name === "pom.xml") {
      const description = file.content.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/\s+/g, " ").trim();
      if (description) return description;
    }
  }
  return "";
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function inferPurpose(
  repoName: string,
  files: IndexedFile[],
  techStack: TechItem[],
  routes: RouteInfo[],
  pages: PageInfo[],
  database: DatabaseInfo[],
  readme: IndexedFile | undefined
): string {
  const readmeHint = summaryFromReadme(readme);
  const configDescription = projectDescriptionFromConfig(files);
  const corpus = `${repoName} ${readmeHint} ${configDescription}`.toLowerCase();

  if (/home-assistant|home assistant|home automation|smart home/.test(corpus)) {
    return "这是 Home Assistant 的核心服务，用来连接和管理智能家居设备、记录家庭状态，并执行自动化场景与规则。";
  }
  if (/student library|library management|图书管理|借阅|borrow/.test(corpus)) {
    return "这是一个图书馆业务管理系统，用来管理图书、读者、借阅归还、预约、逾期处理和后台统计。";
  }
  if (/e-?commerce|online store|shopping cart|商城|电商|购物车/.test(corpus)) {
    return "这是一个电商或在线商城项目，用来展示商品、管理购物车与订单，并支撑用户和后台运营流程。";
  }
  if (/content management|cms|内容管理/.test(corpus)) {
    return "这是一个内容管理系统，用来创建、组织、发布和维护网站内容。";
  }
  if (/blog|博客/.test(corpus)) {
    return "这是一个博客或内容发布项目，用来编辑、展示和管理文章及相关内容。";
  }
  if (/chat|messaging|即时通讯|聊天/.test(corpus)) {
    return "这是一个消息或聊天项目，用来支持用户之间的实时沟通、会话和消息管理。";
  }
  if (/typescript compiler|typescript is a language|microsoft\/typescript/.test(corpus)) {
    return "这是 TypeScript 语言及其编译器的核心代码库，用来为 JavaScript 提供类型检查、代码转换和开发工具能力。";
  }
  if (containsChinese(configDescription)) return configDescription.replace(/[。.!！]+$/, "") + "。";
  if (containsChinese(readmeHint)) return readmeHint.replace(/[。.!！]+$/, "") + "。";

  const tech = techStack.slice(0, 3).map((item) => item.name).join("、");
  const shape = pages.length
    ? "Web 应用"
    : routes.length
      ? "后端服务"
      : database.length
        ? "数据驱动型应用"
        : "软件项目";
  return `这是一个${tech ? `主要使用 ${tech} 构建的` : ""}${shape}。系统已根据代码结构识别其入口、主要模块和运行方式，便于继续开发、部署或二次修改。`;
}

function inferPracticalUses(
  repoName: string,
  files: IndexedFile[],
  readme: IndexedFile | undefined,
  routes: RouteInfo[],
  pages: PageInfo[],
  database: DatabaseInfo[],
  modules: ModuleSummary[]
): string[] {
  const corpus = `${repoName} ${summaryFromReadme(readme)} ${projectDescriptionFromConfig(files)}`.toLowerCase();
  if (/home-assistant|home assistant|home automation|smart home/.test(corpus)) {
    return [
      "统一接入灯具、传感器、空调、门锁等不同品牌的智能家居设备",
      "根据时间、设备状态或用户条件执行自动化规则和家庭场景",
      "记录家庭设备状态，并为仪表盘、通知和远程控制提供核心数据"
    ];
  }
  if (/student library|library management|图书管理|借阅|borrow/.test(corpus)) {
    return [
      "维护图书、读者和馆藏信息，方便管理员进行日常管理",
      "处理借阅、归还、续借、预约和逾期罚款等完整业务流程",
      "提供通知、后台管理和数据统计能力，帮助了解图书馆运行情况"
    ];
  }
  if (/e-?commerce|online store|shopping cart|商城|电商|购物车/.test(corpus)) {
    return [
      "向用户展示和检索商品，并支持购物车与下单流程",
      "管理订单、用户、库存或支付相关业务数据",
      "为运营人员提供商品和订单后台管理入口"
    ];
  }

  const uses: string[] = [];
  if (pages.length) uses.push(`提供 ${pages.length} 个可识别页面或前端入口，支持用户直接操作业务功能`);
  if (routes.length) uses.push(`提供 ${routes.length} 个可识别接口，可供前端、移动端或其他系统调用`);
  if (database.length) uses.push(`包含 ${database.length} 处数据模型、迁移或 SQL 定义，用于保存业务数据`);
  const moduleKinds = new Set(modules.map((item) => item.kind));
  if (moduleKinds.has("测试")) uses.push("包含自动化测试相关代码，可用于验证修改是否影响现有功能");
  if (moduleKinds.has("部署")) uses.push("包含部署或容器配置，可用于搭建运行环境和发布项目");
  if (!uses.length) uses.push("可通过已识别的核心模块和关键文件快速理解项目，并作为二次开发的入口");
  return uses.slice(0, 4);
}

function buildCodeFocus(modules: ModuleSummary[]): string {
  const focusedModules = modules.filter((moduleItem) => moduleItem.path !== ".").slice(0, 4);
  if (!focusedModules.length) {
    return "暂未识别出明确的功能目录，建议先查看 README、构建配置和项目入口文件。";
  }
  return `主要代码集中在 ${focusedModules.map((item) => `${item.path}（${item.kind}）`).join("、")}。`;
}

function buildProjectOverview(
  repoName: string,
  files: IndexedFile[],
  stats: { files: number; scannedFiles: number },
  techStack: TechItem[],
  modules: ModuleSummary[],
  routes: RouteInfo[],
  pages: PageInfo[],
  database: DatabaseInfo[],
  readme: IndexedFile | undefined
) {
  const purpose = inferPurpose(repoName, files, techStack, routes, pages, database, readme);
  const codeFocus = buildCodeFocus(modules);
  const scanLimit = stats.scannedFiles >= MAX_SCAN_FILES ? `，已达到本次 ${MAX_SCAN_FILES} 个文件的扫描上限` : "";
  return {
    purpose,
    practicalUses: inferPracticalUses(repoName, files, readme, routes, pages, database, modules),
    codeFocus,
    scanExplanation: `仓库中统计到 ${stats.files} 个文件，本次读取了其中 ${stats.scannedFiles} 个可分析的源码、配置和文档文件${scanLimit}。图片、压缩包、二进制文件、超大文件以及 node_modules、dist 等依赖或构建目录不会读取。`
  };
}

function findNotableFiles(files: IndexedFile[]): FileReference[] {
  const patterns = [
    /readme/i,
    /package\.json$/i,
    /pom\.xml$/i,
    /build\.gradle$/i,
    /requirements\.txt$/i,
    /pyproject\.toml$/i,
    /docker-compose\.ya?ml$/i,
    /dockerfile$/i,
    /vite\.config/i,
    /next\.config/i,
    /tsconfig\.json$/i,
    /schema\.prisma$/i
  ];

  return files
    .filter((file) => patterns.some((pattern) => pattern.test(file.path)))
    .slice(0, 20)
    .map((file) => ({
      file: file.path,
      reason: "项目入口、配置或说明文件"
    }));
}

export async function analyzeRepository(repoPath: string, target: RepoTarget, signal?: AbortSignal): Promise<{ result: AnalysisResult; files: IndexedFile[] }> {
  throwIfAborted(signal);

  const [tree, scan] = await Promise.all([buildTree(repoPath, "", 0, signal), scanRepository(repoPath, signal)]);
  throwIfAborted(signal);

  tree.name = target.fullName;
  const techStack = detectTech(scan.files);
  throwIfAborted(signal);
  const runSteps = inferRunSteps(scan.files, techStack);
  throwIfAborted(signal);
  const modules = inferModules(scan.files, techStack);
  throwIfAborted(signal);
  const routes = findRoutes(scan.files);
  throwIfAborted(signal);
  const pages = findPages(scan.files, techStack);
  throwIfAborted(signal);
  const database = findDatabase(scan.files);
  throwIfAborted(signal);
  const readme = findReadme(scan.files);
  const notableFiles = findNotableFiles(scan.files);
  const overview = buildProjectOverview(
    target.fullName,
    scan.files,
    { files: scan.fileCount, scannedFiles: scan.files.length },
    techStack,
    modules,
    routes,
    pages,
    database,
    readme
  );

  const result: AnalysisResult = {
    repoId: target.id,
    repoUrl: target.webUrl,
    repoName: target.fullName,
    analyzedAt: new Date().toISOString(),
    tree,
    stats: {
      files: scan.fileCount,
      directories: scan.dirCount,
      scannedFiles: scan.files.length,
      totalBytes: scan.totalBytes
    },
    techStack,
    summary: `${overview.purpose} ${overview.codeFocus}`,
    overview,
    runSteps,
    modules,
    routes,
    pages,
    database,
    notableFiles
  };

  return { result, files: scan.files };
}
