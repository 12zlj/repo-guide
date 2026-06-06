import {
  ArrowLeft,
  BookOpen,
  Braces,
  CalendarClock,
  Camera,
  CircleAlert,
  Database,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileDown,
  Folder,
  FolderTree,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  ImagePlus,
  LockKeyhole,
  LogOut,
  Loader2,
  Mail,
  Network,
  Play,
  RefreshCcw,
  Save,
  SearchCode,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
  UserPlus,
  Workflow,
  XCircle
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisResult,
  AnalysisRecord,
  DatabaseInfo,
  DownloadRecord,
  FavoriteRepository,
  ModuleSummary,
  PageInfo,
  PersonalCenterData,
  ProfileUser,
  ReportFormat,
  RouteInfo,
  RunGuideResponse,
  RunStep,
  TechItem,
  TreeNode
} from "./types";

type TabId = "overview" | "modules" | "interfaces" | "database";
type UserSession = ProfileUser;
type AuthResponse = { user: UserSession };
type ReportDetail = {
  record: AnalysisRecord;
  analysis?: AnalysisResult;
  runGuide?: RunGuideResponse;
};

const tabs: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "overview", label: "概览", icon: <BookOpen size={16} /> },
  { id: "modules", label: "模块", icon: <Workflow size={16} /> },
  { id: "interfaces", label: "接口/页面", icon: <Network size={16} /> },
  { id: "database", label: "数据", icon: <Database size={16} /> }
];

const sampleRepos = [
  { label: "Spring Boot", url: "https://github.com/12zlj/-" },
  { label: "Python", url: "https://github.com/home-assistant/core" },
  { label: "TypeScript", url: "https://github.com/microsoft/TypeScript" }
];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败");
  }
  return payload as T;
}

async function downloadFile(url: string): Promise<void> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    throw new Error(payload.error ?? "下载失败");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  const quotedName = disposition.match(/filename="([^"]+)"/)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : quotedName ?? "repo-report";
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function initialsOf(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "用户";
}

function imageFileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件。"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("图片不能超过 10 MB。"));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 320;
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = (image.naturalWidth - sourceSize) / 2;
      const sourceY = (image.naturalHeight - sourceSize) / 2;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("图片处理失败，请重新选择。"));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.84));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取该图片，请更换图片。"));
    };
    image.src = objectUrl;
  });
}

function PathText({ file, line }: { file: string; line?: number }) {
  return (
    <span className="path-text" title={line ? `${file}:${line}` : file}>
      {file}
      {line ? <span className="line-number">:{line}</span> : null}
    </span>
  );
}

function Panel({
  title,
  icon,
  children,
  action,
  className
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={["panel", className].filter(Boolean).join(" ")}>
      <div className="panel-header">
        <div className="panel-title">
          {icon}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, icon, description }: { label: string; value: string | number; icon: ReactNode; description: string }) {
  return (
    <div className="stat" title={description}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{description}</small>
      </div>
    </div>
  );
}

function TreeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const isRoot = node.path === ".";
  return (
    <div className="tree-node" style={{ "--depth": depth } as React.CSSProperties}>
      <div className="tree-row">
        {node.type === "directory" ? <Folder size={15} /> : <FileCode2 size={15} />}
        <span title={node.path}>{isRoot ? node.name : node.name}</span>
        {node.truncated ? <small>已截断</small> : null}
      </div>
      {node.children?.length ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeView key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TechStack({ items }: { items: TechItem[] }) {
  if (!items.length) {
    return <p className="muted">暂未识别到明确技术栈。</p>;
  }

  return (
    <div className="tech-list">
      {items.map((item) => (
        <div className="tech-chip" key={item.name} title={item.evidence.join("\n")}>
          <span>{item.category}</span>
          <strong>{item.name}</strong>
        </div>
      ))}
    </div>
  );
}

function RunSteps({ steps }: { steps: RunStep[] }) {
  return (
    <div className="run-list">
      {steps.map((step, index) => (
        <div className="run-step" key={`${step.label}-${index}`}>
          <div className="step-index">{index + 1}</div>
          <div>
            <h3>{step.label}</h3>
            <code>{step.command}</code>
            <div className="meta-line">
              {step.cwd ? <span>目录：{step.cwd}</span> : null}
              {step.note ? <span>脚本：{step.note}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModuleList({ modules }: { modules: ModuleSummary[] }) {
  return (
    <div className="module-list">
      {modules.map((moduleItem) => (
        <article className="module-row" key={`${moduleItem.path}-${moduleItem.kind}`}>
          <div className="module-main">
            <span className="kind-label">{moduleItem.kind}</span>
            <h3>{moduleItem.name}</h3>
            <p>{moduleItem.description}</p>
          </div>
          <div className="file-list">
            {moduleItem.keyFiles.map((file) => (
              <PathText key={file} file={file} />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function RouteList({ routes, pages }: { routes: RouteInfo[]; pages: PageInfo[] }) {
  const routeGroups = routes.reduce<Array<{ name: string; routes: RouteInfo[] }>>((groups, route) => {
    const groupName = route.group ?? "其他接口";
    const existing = groups.find((group) => group.name === groupName);
    if (existing) {
      existing.routes.push(route);
    } else {
      groups.push({ name: groupName, routes: [route] });
    }
    return groups;
  }, []);
  const methodCount = new Set(routes.map((route) => route.method)).size;

  return (
    <div className="entry-guide">
      <div className="entry-guide-summary">
        <div>
          <span>后端接口</span>
          <strong>{formatCount(routes.length)}</strong>
          <small>{methodCount ? `覆盖 ${methodCount} 种请求方式` : "未识别标准接口"}</small>
        </div>
        <div>
          <span>用户页面</span>
          <strong>{formatCount(pages.length)}</strong>
          <small>{pages.length ? "可访问的页面或前端入口" : "可能是纯后端项目"}</small>
        </div>
        <p>接口表示系统能对外提供的功能；页面表示用户可以直接打开和操作的界面。文件路径用于帮助开发者定位实现代码。</p>
      </div>

      <section className="entry-section">
        <div className="entry-section-head">
          <div>
            <span>API</span>
            <h3>系统提供哪些接口？</h3>
          </div>
          <p>已合并控制器公共前缀，并按业务用途分组。</p>
        </div>
        {routes.length ? (
          <div className="route-groups">
            {routeGroups.map((group) => (
              <section className="route-group" key={group.name}>
                <div className="route-group-head">
                  <strong>{group.name}</strong>
                  <span>{group.routes.length} 个接口</span>
                </div>
                <div className="route-card-list">
                  {group.routes.slice(0, 40).map((route, index) => (
                    <article className="route-card" key={`${route.file}-${route.line}-${index}`}>
                      <span className={["method", `method-${route.method.toLowerCase()}`].join(" ")}>
                        {route.method === "ALL" ? "通用" : route.method}
                      </span>
                      <div className="route-card-main">
                        <strong>{route.route}</strong>
                        <p>{route.description ?? "该接口用于处理相关业务请求。"}</p>
                        <PathText file={route.file} line={route.line} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="entry-empty">
            <Network size={20} />
            <div>
              <strong>未识别到标准 HTTP 接口</strong>
              <p>项目可能不是 Web 服务，或者使用了当前规则尚未覆盖的路由框架。</p>
            </div>
          </div>
        )}
      </section>

      <section className="entry-section">
        <div className="entry-section-head">
          <div>
            <span>UI</span>
            <h3>用户可以打开哪些页面？</h3>
          </div>
          <p>包括 HTML 文件、前端路由和页面组件。</p>
        </div>
        {pages.length ? (
          <div className="page-card-list">
            {pages.slice(0, 60).map((page, index) => (
              <article className="page-card" key={`${page.file}-${page.route}-${index}`}>
                <span className="page-card-icon">
                  <Globe size={14} />
                </span>
                <div className="page-card-main">
                  <div>
                    <strong>{page.name ?? (page.route === "/" ? "首页" : page.route)}</strong>
                    <span>{page.framework ?? "页面"}</span>
                  </div>
                  <code>{page.route}</code>
                  <p>{page.description ?? "用户可访问的页面入口。"}</p>
                  <PathText file={page.file} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="entry-empty">
            <Globe size={20} />
            <div>
              <strong>未识别到独立页面入口</strong>
              <p>这通常表示项目是后端服务、程序库，或者前端页面由其他仓库提供。</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DatabaseList({ database }: { database: DatabaseInfo[] }) {
  if (!database.length) {
    return (
      <div className="database-empty">
        <Database size={22} />
        <div>
          <strong>未识别到数据库结构</strong>
          <p>项目可能没有数据库，或者数据库定义位于当前规则尚未覆盖的外部服务中。</p>
        </div>
      </div>
    );
  }

  const tableEntries = database.filter((entry) => entry.kind === "SQL table");
  const sourceFiles = new Set(database.map((entry) => entry.file)).size;
  const relationCount = database.reduce((total, entry) => total + (entry.foreignKeys?.length ?? 0), 0);

  return (
    <div className="database-guide">
      <div className="database-summary">
        <div>
          <span>数据对象</span>
          <strong>{formatCount(database.length)}</strong>
          <small>{tableEntries.length ? `${tableEntries.length} 张 SQL 表` : "模型或迁移定义"}</small>
        </div>
        <div>
          <span>关系连接</span>
          <strong>{formatCount(relationCount)}</strong>
          <small>通过外键关联的数据关系</small>
        </div>
        <div>
          <span>定义来源</span>
          <strong>{formatCount(sourceFiles)}</strong>
          <small>SQL、模型或迁移文件</small>
        </div>
      </div>

      <div className="database-intro">
        <Database size={17} />
        <p>下面展示系统保存了哪些业务数据，以及表之间如何关联。字段只展示关键部分，文件路径可用于定位完整定义。</p>
      </div>

      <div className="database-card-list">
        {database.slice(0, 80).map((entry, index) => (
          <article className="database-card" key={`${entry.file}-${entry.line}-${index}`}>
            <div className="database-card-head">
              <div>
                <span className="db-kind">{entry.kind === "SQL table" ? "数据表" : entry.kind}</span>
                <h3>{entry.name ?? "未命名对象"}</h3>
              </div>
              <PathText file={entry.file} line={entry.line} />
            </div>

            <p className="database-description">{entry.description ?? "保存项目中的业务数据。"}</p>

            {entry.columns?.length ? (
              <div className="database-columns">
                <div className="database-meta-line">
                  <span>{entry.columns.length} 个字段</span>
                  {entry.primaryKey?.length ? <span>主键：{entry.primaryKey.join("、")}</span> : null}
                </div>
                <div className="database-column-list">
                  {entry.columns.slice(0, 8).map((column) => (
                    <div key={column.name}>
                      <strong>{column.name}</strong>
                      <span>{column.type}</span>
                      {column.primaryKey ? <small>主键</small> : !column.nullable ? <small>必填</small> : null}
                    </div>
                  ))}
                  {entry.columns.length > 8 ? <p>还有 {entry.columns.length - 8} 个字段未展开</p> : null}
                </div>
              </div>
            ) : null}

            {entry.foreignKeys?.length ? (
              <div className="database-relations">
                <strong>关联关系</strong>
                {entry.foreignKeys.map((foreignKey) => (
                  <div key={`${foreignKey.column}-${foreignKey.referencedTable}`}>
                    <Network size={13} />
                    <span>
                      {foreignKey.column} → {foreignKey.referencedTable}.{foreignKey.referencedColumn}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function RunGuideChips({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (!items.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="run-guide-chips">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function RunGuideFileList({ files, emptyText }: { files: string[]; emptyText: string }) {
  if (!files.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="run-guide-files">
      {files.map((file) => (
        <PathText key={file} file={file} />
      ))}
    </div>
  );
}

function RunGuideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="run-guide-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function RunGuideSteps({ steps, emptyText }: { steps: string[]; emptyText: string }) {
  if (!steps.length) return <p className="muted">{emptyText}</p>;
  return (
    <ol className="run-guide-steps">
      {steps.map((step, index) => (
        <li key={`${step}-${index}`}>{step}</li>
      ))}
    </ol>
  );
}

function RunGuideWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return <p className="muted">暂未生成额外注意事项。</p>;
  return (
    <ul className="run-guide-warnings">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function RunGuideConfigItems({ items }: { items: RunGuideResponse["configItems"] }) {
  const configItemLabels = [
    { key: "serverPort", label: "server.port" },
    { key: "databaseUrl", label: "spring.datasource.url" },
    { key: "databaseUsername", label: "spring.datasource.username" },
    { key: "databasePassword", label: "spring.datasource.password" },
    { key: "redisHost", label: "redis.host" },
    { key: "redisPort", label: "redis.port" },
    { key: "backendApiUrl", label: "后端接口地址" },
    { key: "frontendPort", label: "前端端口" }
  ] satisfies Array<{ key: keyof RunGuideResponse["configItems"]; label: string }>;
  const entries = configItemLabels.filter((entry) => items[entry.key]);

  if (!entries.length) return null;

  return (
    <div className="run-guide-config-items">
      {entries.map((entry) => (
        <div key={entry.key}>
          <span>{entry.label}</span>
          <strong>{items[entry.key]}</strong>
        </div>
      ))}
    </div>
  );
}

function RunGuidePanel({ analysis }: { analysis?: AnalysisResult }) {
  const [guide, setGuide] = useState<RunGuideResponse | undefined>();
  const [loadingGuide, setLoadingGuide] = useState(false);
  const [guideError, setGuideError] = useState("");

  useEffect(() => {
    if (!analysis) {
      setGuide(undefined);
      setGuideError("");
      setLoadingGuide(false);
      return;
    }

    let cancelled = false;
    setLoadingGuide(true);
    setGuideError("");
    setGuide(undefined);

    requestJson<RunGuideResponse>(`/api/repository/run-guide?repoId=${encodeURIComponent(analysis.repoId)}`)
      .then((payload) => {
        if (!cancelled) setGuide(payload);
      })
      .catch(() => {
        if (!cancelled) setGuideError("项目运行向导生成失败，请检查仓库地址或文件结构。");
      })
      .finally(() => {
        if (!cancelled) setLoadingGuide(false);
      });

    return () => {
      cancelled = true;
    };
  }, [analysis?.repoId]);

  return (
    <Panel
      title="项目运行向导"
      icon={<Play size={18} />}
      className="run-guide-panel"
      action={analysis ? (
        <a
          className="project-download-button"
          href={`/api/repositories/${encodeURIComponent(analysis.repoId)}/archive`}
          title="下载当前仓库源码压缩包"
        >
          <Download size={15} />
          <span>下载项目</span>
        </a>
      ) : undefined}
    >
      {!analysis ? (
        <div className="run-guide-empty">
          <Play size={20} />
          <p>请先输入 GitHub 仓库地址并点击“分析”，系统会自动生成项目运行向导。</p>
        </div>
      ) : null}

      {analysis && loadingGuide ? (
        <div className="run-guide-empty">
          <Loader2 size={20} className="spin" />
          <p>正在生成项目运行向导。</p>
        </div>
      ) : null}

      {analysis && guideError ? (
        <div className="error-note">
          <CircleAlert size={16} />
          <span>{guideError}</span>
        </div>
      ) : null}

      {analysis && guide && !loadingGuide ? (
        <div className="run-guide-content">
          <div className="run-guide-summary">
            <span>当前仓库</span>
            <strong>{analysis.repoName}</strong>
          </div>

          <RunGuideSection title="项目类型">
            <RunGuideChips items={guide.projectTypes} emptyText="暂未识别到明确项目类型。" />
          </RunGuideSection>

          <RunGuideSection title="运行环境">
            <RunGuideChips items={guide.environments} emptyText="暂未识别到必需运行环境。" />
          </RunGuideSection>

          <RunGuideSection title="数据库文件">
            <RunGuideFileList files={guide.databaseFiles} emptyText="未检测到数据库 SQL 文件" />
          </RunGuideSection>

          <RunGuideSection title="配置文件">
            <RunGuideFileList files={guide.configFiles} emptyText="暂未检测到常见配置文件。" />
            <RunGuideConfigItems items={guide.configItems} />
          </RunGuideSection>

          <RunGuideSection title="后端启动步骤">
            <RunGuideSteps steps={guide.backendSteps} emptyText="未根据规则识别到后端启动步骤。" />
          </RunGuideSection>

          <RunGuideSection title="前端启动步骤">
            <RunGuideSteps steps={guide.frontendSteps} emptyText="未根据规则识别到前端启动步骤。" />
          </RunGuideSection>

          <RunGuideSection title="注意事项">
            <RunGuideWarnings warnings={guide.warnings} />
          </RunGuideSection>
        </div>
      ) : null}
    </Panel>
  );
}
function Overview({ analysis }: { analysis: AnalysisResult }) {
  return (
    <div className="overview-grid">
      <Panel title="项目简介" icon={<BookOpen size={18} />} className="summary-panel">
        <div className="summary-layout">
          <div className="summary-copy">
            <span className="summary-kicker">项目定位</span>
            <h3>这个项目是做什么的？</h3>
            <p className="summary-text">{analysis.overview.purpose}</p>
          </div>
          <div className="overview-uses">
            <strong>实际用途</strong>
            <div className="overview-use-list">
              {analysis.overview.practicalUses.map((use) => (
                <div key={use}>
                  <span aria-hidden="true" />
                  <p>{use}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="overview-code-focus">
            <strong>代码重点在哪里？</strong>
            <p>{analysis.overview.codeFocus}</p>
          </div>
          <div className="stats-grid" aria-label="仓库规模">
            <Stat
              label="仓库文件"
              value={formatCount(analysis.stats.files)}
              icon={<FileCode2 size={18} />}
              description="排除依赖与构建目录后统计到的文件"
            />
            <Stat
              label="代码目录"
              value={formatCount(analysis.stats.directories)}
              icon={<FolderTree size={18} />}
              description="用于生成目录树和模块结构的目录"
            />
            <Stat
              label="分析文件"
              value={formatCount(analysis.stats.scannedFiles)}
              icon={<SearchCode size={18} />}
              description="已读取内容并参与技术栈、接口和模块识别"
            />
            <Stat
              label="仓库体量"
              value={formatBytes(analysis.stats.totalBytes)}
              icon={<HardDrive size={18} />}
              description="已统计仓库文件的总大小"
            />
          </div>
          <div className="scan-explanation">
            <SearchCode size={16} />
            <p>{analysis.overview.scanExplanation}</p>
          </div>
        </div>
      </Panel>
      <Panel title="技术栈" icon={<Braces size={18} />} className="tech-panel">
        <TechStack items={analysis.techStack} />
      </Panel>
      <Panel title="运行步骤" icon={<Play size={18} />} className="run-panel">
        <RunSteps steps={analysis.runSteps} />
      </Panel>
      <Panel title="关键文件" icon={<FileCode2 size={18} />} className="files-panel">
        {analysis.notableFiles.length ? (
          <div className="file-list roomy">
            {analysis.notableFiles.map((reference) => (
              <PathText key={reference.file} file={reference.file} />
            ))}
          </div>
        ) : (
          <p className="muted">暂未识别到关键配置文件。</p>
        )}
      </Panel>
    </div>
  );
}

function AnalysisWorkspace({ analysis, activeTab, onTabChange }: { analysis: AnalysisResult; activeTab: TabId; onTabChange: (tab: TabId) => void }) {
  const tabContent = useMemo(() => {
    switch (activeTab) {
      case "modules":
        return (
          <Panel title="核心模块" icon={<Workflow size={18} />} className="modules-panel">
            <ModuleList modules={analysis.modules} />
          </Panel>
        );
      case "interfaces":
        return (
          <Panel title="接口与页面" icon={<Network size={18} />} className="interfaces-panel">
            <RouteList routes={analysis.routes} pages={analysis.pages} />
          </Panel>
        );
      case "database":
        return (
          <Panel title="数据库结构" icon={<Database size={18} />} className="database-panel">
            <DatabaseList database={analysis.database} />
          </Panel>
        );
      default:
        return <Overview analysis={analysis} />;
    }
  }, [activeTab, analysis]);

  return (
    <div className="workspace-grid">
      <aside className="left-rail">
        <Panel
          title="目录树"
          icon={<FolderTree size={18} />}
          className="tree-panel"
          action={<span className="scan-time">{formatDate(analysis.analyzedAt)}</span>}
        >
          <div className="tree-box">
            <TreeView node={analysis.tree} />
          </div>
        </Panel>
      </aside>
      <main className="main-rail">
        <div className="repo-strip">
          <div>
            <span>当前仓库</span>
            <strong>{analysis.repoName}</strong>
          </div>
          <a href={analysis.repoUrl} target="_blank" rel="noreferrer">
            <Github size={16} />
            GitHub
          </a>
        </div>
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => onTabChange(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        {tabContent}
      </main>
      <aside className="right-rail">
        <RunGuidePanel analysis={analysis} />
      </aside>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="auth-shell">
      <div className="auth-loading">
        <Loader2 size={28} className="spin" />
        <strong>正在校验登录状态</strong>
      </div>
    </div>
  );
}

function LoginPage({
  onLogin,
  onRegister
}: {
  onLogin: (email: string, password: string, remember: boolean) => Promise<void>;
  onRegister: (name: string, email: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setError("");
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError(mode === "register" ? "请完整填写注册信息。" : "请输入邮箱和密码。");
      return;
    }
    if (mode === "register") {
      if (name.trim().length < 2) {
        setError("用户名至少需要 2 个字符。");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        setError("请输入有效的邮箱地址。");
        return;
      }
      if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
        setError("密码至少 8 位，并同时包含字母和数字。");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致。");
        return;
      }
    }

    setSubmitting(true);
    setError("");
    try {
      if (mode === "register") {
        await onRegister(name.trim(), normalizedEmail, password);
      } else {
        await onLogin(normalizedEmail, password, remember);
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : mode === "register" ? "注册失败，请稍后再试。" : "登录失败，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <main className="auth-layout">
        <section className="auth-hero" aria-label={mode === "register" ? "平台注册" : "平台登录"}>
          <div className="auth-brand">
            <SearchCode size={32} />
            <div>
              <span>Repo Guide Platform</span>
              <h1>代码仓库智能导览器</h1>
            </div>
          </div>
          <div className="auth-copy">
            <div className="auth-kicker">
              <ShieldCheck size={16} />
              <span>团队工作台</span>
            </div>
            <h2>{mode === "register" ? "创建属于你的仓库分析空间" : "登录后进入你的仓库分析空间"}</h2>
            <p>{mode === "register" ? "注册后即可保存分析记录、收藏仓库并下载完整项目报告。" : "每个用户拥有独立会话，分析记录、运行向导和仓库入口都从登录态开始。"}</p>
          </div>
          <div className="auth-metrics" aria-label="平台能力">
            <div>
              <strong>GitHub</strong>
              <span>仓库导入</span>
            </div>
            <div>
              <strong>AI Guide</strong>
              <span>结构分析</span>
            </div>
            <div>
              <strong>Q&A</strong>
              <span>运行向导</span>
            </div>
          </div>
        </section>

        <section className="auth-card" aria-label={mode === "register" ? "注册表单" : "登录表单"}>
          <div className="auth-card-head">
            <div>
              <span>{mode === "register" ? "开始使用" : "欢迎回来"}</span>
              <h2>{mode === "register" ? "注册账号" : "登录平台"}</h2>
            </div>
          </div>

          <form className="login-form" onSubmit={submitAuth}>
            {mode === "register" ? (
              <label>
                <span>用户名</span>
                <div className="login-field">
                  <UserRound size={18} />
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="请输入用户名"
                    autoComplete="name"
                    disabled={submitting}
                  />
                </div>
              </label>
            ) : null}
            <label>
              <span>邮箱</span>
              <div className="login-field">
                <Mail size={18} />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="请输入登录邮箱"
                  autoComplete="email"
                  disabled={submitting}
                />
              </div>
            </label>
            <label>
              <span>密码</span>
              <div className="login-field password-field">
                <LockKeyhole size={18} />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入登录密码"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={submitting}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {mode === "register" ? (
              <label>
                <span>确认密码</span>
                <div className="login-field password-field">
                  <LockKeyhole size={18} />
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="请再次输入密码"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    disabled={submitting}
                    aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"}
                    title={showConfirmPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            ) : null}

            <div className="login-options">
              {mode === "login" ? (
                <label className="remember-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    disabled={submitting}
                  />
                  <span>保持登录</span>
                </label>
              ) : (
                <span className="register-note">注册即创建个人工作区</span>
              )}
              <button type="button" onClick={() => switchMode(mode === "login" ? "register" : "login")} disabled={submitting}>
                {mode === "login" ? "注册账号" : "已有账号，返回登录"}
              </button>
            </div>

            {error ? (
              <div className="login-error">
                <CircleAlert size={16} />
                <span>{error}</span>
              </div>
            ) : null}

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 size={18} className="spin" /> : mode === "register" ? <UserPlus size={18} /> : <ShieldCheck size={18} />}
              <span>{submitting ? (mode === "register" ? "正在注册" : "正在登录") : mode === "register" ? "创建账号" : "登录平台"}</span>
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function LoadingState({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="loading-state">
      <Loader2 size={28} className="spin" />
      <div>
        <strong>正在拉取并分析仓库</strong>
        <span>大仓库可能需要几十秒。</span>
      </div>
      <button type="button" onClick={onCancel}>
        <XCircle size={17} />
        <span>取消分析</span>
      </button>
    </div>
  );
}

function HomeLanding({ onSelectSample }: { onSelectSample: (url: string) => void }) {
  return (
    <section className="home-stage">
      <div className="home-copy">
        <div className="home-kicker">
          <Github size={16} />
          <span>GitHub Repository Guide</span>
        </div>
        <h2>把陌生代码仓库，变成一张清晰导览图</h2>
        <p>输入一个仓库地址，马上看到结构、启动线索、核心模块和可执行的运行步骤。</p>
        <div className="sample-repos" aria-label="示例仓库">
          {sampleRepos.map((repo) => (
            <button key={repo.url} type="button" onClick={() => onSelectSample(repo.url)}>
              <GitBranch size={15} />
              <span>{repo.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="home-preview" aria-label="导览预览轮播">
        <div className="preview-top">
          <div>
            <span>repo-guide-MVP</span>
            <strong>智能导览演示</strong>
          </div>
          <div className="preview-status">Live Preview</div>
        </div>

        <div className="preview-carousel">
          <div className="carousel-track">
            <article className="carousel-slide">
              <div className="slide-title">
                <span>01</span>
                <div>
                  <h3>架构地图</h3>
                  <p>先看目录，再看模块关系。</p>
                </div>
              </div>
              <div className="preview-grid">
                <div className="preview-tree">
                  <div><FolderTree size={15} /> server</div>
                  <div><FileCode2 size={15} /> analyzer.ts</div>
                  <div><FileCode2 size={15} /> git.ts</div>
                  <div><FolderTree size={15} /> src</div>
                  <div><FileCode2 size={15} /> App.tsx</div>
                </div>
                <div className="preview-insight">
                  <span>Tech Stack</span>
                  <div className="preview-tags">
                    <strong>React</strong>
                    <strong>Express</strong>
                    <strong>TypeScript</strong>
                  </div>
                  <div className="preview-answer">
                    <FileCode2 size={15} />
                    <p>配置文件已识别</p>
                    <small>server/index.ts</small>
                  </div>
                </div>
              </div>
            </article>

            <article className="carousel-slide">
              <div className="slide-title">
                <span>02</span>
                <div>
                  <h3>启动路径</h3>
                  <p>把 README 和脚本线索整理成步骤。</p>
                </div>
              </div>
              <div className="preview-runbook">
                <div className="runbook-step">
                  <strong>1</strong>
                  <div>
                    <span>安装依赖</span>
                    <code>npm install</code>
                  </div>
                </div>
                <div className="runbook-step">
                  <strong>2</strong>
                  <div>
                    <span>启动服务</span>
                    <code>npm run dev</code>
                  </div>
                </div>
                <div className="runbook-metrics">
                  <div><span>文件</span><strong>2,486</strong></div>
                  <div><span>接口</span><strong>42</strong></div>
                  <div><span>页面</span><strong>18</strong></div>
                </div>
              </div>
            </article>

            <article className="carousel-slide">
              <div className="slide-title">
                <span>03</span>
                <div>
                  <h3>运行向导</h3>
                  <p>自动整理环境、配置和启动步骤。</p>
                </div>
              </div>
              <div className="preview-chat">
                <div className="chat-question">
                  项目类型：Spring Boot / Maven
                </div>
                <div className="chat-answer">
                  <Play size={17} />
                  <div>
                    <p>安装 JDK 和 Maven，启动 MySQL，导入 SQL 后运行。</p>
                    <small>application.properties</small>
                    <small>database/init.sql</small>
                    <small>mvn spring-boot:run</small>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <div className="preview-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProfileAvatar({ user, size = "normal" }: { user: ProfileUser; size?: "normal" | "large" }) {
  return (
    <div className={["profile-avatar", size === "large" ? "large" : ""].filter(Boolean).join(" ")}>
      {user.avatarUrl ? <img src={user.avatarUrl} alt={user.name} /> : <span>{initialsOf(user.name)}</span>}
    </div>
  );
}

function ProfileChips({ values, emptyText }: { values: string[]; emptyText: string }) {
  if (!values.length) return <span className="profile-empty-inline">{emptyText}</span>;
  return (
    <div className="profile-chips">
      {values.slice(0, 6).map((value) => (
        <span key={value}>{value}</span>
      ))}
    </div>
  );
}

function AnalysisRecordCard({
  record,
  onOpen,
  onReanalyze,
  onDelete,
  onToggleFavorite,
  onDownload
}: {
  record: AnalysisRecord;
  onOpen: (record: AnalysisRecord) => void;
  onReanalyze: (record: AnalysisRecord) => void;
  onDelete: (record: AnalysisRecord) => void;
  onToggleFavorite: (record: AnalysisRecord) => void;
  onDownload: (record: AnalysisRecord, format: ReportFormat) => void;
}) {
  return (
    <article className="profile-record-card">
      <div className="profile-record-main">
        <div className="profile-record-title">
          <strong>{record.repoName}</strong>
          <span className={["status-pill", record.status].join(" ")}>
            {record.status === "success" ? "分析成功" : "分析失败"}
          </span>
        </div>
        <a href={record.repoUrl} target="_blank" rel="noreferrer">
          {record.repoUrl}
        </a>
        <p>{record.error ?? record.summary}</p>
        <div className="profile-record-meta">
          <span>
            <CalendarClock size={13} />
            {formatFullDate(record.analyzedAt)}
          </span>
          <ProfileChips values={record.projectTypes} emptyText="未识别项目类型" />
          <ProfileChips values={record.techStack} emptyText="未识别技术栈" />
        </div>
      </div>
      <div className="profile-record-actions">
        <button type="button" onClick={() => onOpen(record)} disabled={record.status !== "success"} title="查看详情">
          <Eye size={15} />
          <span>查看详情</span>
        </button>
        <button type="button" onClick={() => onReanalyze(record)} title="重新分析">
          <RefreshCcw size={15} />
          <span>重新分析</span>
        </button>
        <button type="button" onClick={() => onToggleFavorite(record)} disabled={record.status !== "success"} title={record.favorite ? "取消收藏" : "收藏仓库"}>
          <Star size={15} />
          <span>{record.favorite ? "取消收藏" : "收藏"}</span>
        </button>
        <button type="button" onClick={() => onDownload(record, "markdown")} disabled={record.status !== "success"} title="下载 Markdown">
          <FileDown size={15} />
          <span>下载 Markdown</span>
        </button>
        <button type="button" onClick={() => onDownload(record, "pdf")} disabled={record.status !== "success"} title="下载 PDF">
          <Download size={15} />
          <span>下载 PDF</span>
        </button>
        <button type="button" className="danger" onClick={() => onDelete(record)} title="删除记录">
          <Trash2 size={15} />
          <span>删除</span>
        </button>
      </div>
    </article>
  );
}

function DownloadRecordRow({ record, onDownload }: { record: DownloadRecord; onDownload: (record: DownloadRecord) => void }) {
  return (
    <div className="download-row">
      <div>
        <strong>{record.reportName}</strong>
        <span>{record.repoName}</span>
      </div>
      <span className="format-pill">{record.format === "pdf" ? "PDF" : "Markdown"}</span>
      <span>{formatFullDate(record.downloadedAt)}</span>
      <button type="button" onClick={() => onDownload(record)}>
        <Download size={15} />
        再次下载
      </button>
    </div>
  );
}

function ReportDetailPreview({
  detail,
  onBack,
  onDownload
}: {
  detail: ReportDetail;
  onBack: () => void;
  onDownload: (record: AnalysisRecord, format: ReportFormat) => void;
}) {
  const { record, analysis, runGuide } = detail;
  const fallbackTech = record.techStack.map((name) => ({ name, category: "技术栈", evidence: [] }));
  const detailTechStack = analysis?.techStack ?? fallbackTech;

  return (
    <div className="report-detail-page">
      <section className="report-detail-head panel">
        <button type="button" className="ghost-back-button" onClick={onBack}>
          <ArrowLeft size={16} />
          返回个人中心
        </button>
        <div className="report-detail-title">
          <span>分析报告详情</span>
          <h2>{record.repoName}</h2>
          <a href={record.repoUrl} target="_blank" rel="noreferrer">
            {record.repoUrl}
          </a>
        </div>
        <div className="report-detail-actions">
          <button type="button" onClick={() => onDownload(record, "markdown")}>
            <FileDown size={15} />
            下载 Markdown
          </button>
          <button type="button" onClick={() => onDownload(record, "pdf")}>
            <Download size={15} />
            下载 PDF
          </button>
        </div>
      </section>

      <div className="report-detail-grid">
        <Panel title="项目简介" icon={<BookOpen size={18} />} className="report-detail-section wide">
          <p className="report-detail-summary">{analysis?.summary ?? record.summary}</p>
          <div className="report-detail-tags">
            <ProfileChips values={record.projectTypes} emptyText="未识别项目类型" />
            <ProfileChips values={record.techStack} emptyText="未识别技术栈" />
            <span className="profile-empty-inline">分析时间：{formatFullDate(record.analyzedAt)}</span>
          </div>
        </Panel>

        <Panel title="目录结构" icon={<FolderTree size={18} />} className="report-detail-section">
          {analysis ? (
            <div className="detail-tree-box">
              <TreeView node={analysis.tree} />
            </div>
          ) : (
            <p className="muted">暂无目录结构详情，请重新分析该仓库。</p>
          )}
        </Panel>

        <Panel title="技术栈" icon={<Braces size={18} />} className="report-detail-section">
          <TechStack items={detailTechStack} />
        </Panel>

        <Panel title="模块说明" icon={<Workflow size={18} />} className="report-detail-section wide">
          {analysis?.modules.length ? <ModuleList modules={analysis.modules} /> : <p className="muted">暂未识别到核心模块说明。</p>}
        </Panel>

        <Panel title="接口/页面说明" icon={<Network size={18} />} className="report-detail-section wide">
          {analysis ? <RouteList routes={analysis.routes} pages={analysis.pages} /> : <p className="muted">暂无接口/页面详情。</p>}
        </Panel>

        <Panel title="数据库说明" icon={<Database size={18} />} className="report-detail-section">
          {analysis ? <DatabaseList database={analysis.database} /> : <p className="muted">暂无数据库详情。</p>}
        </Panel>

        <Panel title="项目运行指南" icon={<Play size={18} />} className="report-detail-section">
          {runGuide ? (
            <div className="run-guide-content detail-run-guide">
              <RunGuideSection title="项目类型">
                <RunGuideChips items={runGuide.projectTypes} emptyText="暂未识别到明确项目类型。" />
              </RunGuideSection>
              <RunGuideSection title="运行环境">
                <RunGuideChips items={runGuide.environments} emptyText="暂未识别到必需运行环境。" />
              </RunGuideSection>
              <RunGuideSection title="数据库文件">
                <RunGuideFileList files={runGuide.databaseFiles} emptyText="未检测到数据库 SQL 文件" />
              </RunGuideSection>
              <RunGuideSection title="配置文件">
                <RunGuideFileList files={runGuide.configFiles} emptyText="暂未检测到常见配置文件。" />
                <RunGuideConfigItems items={runGuide.configItems} />
              </RunGuideSection>
              <RunGuideSection title="后端启动步骤">
                <RunGuideSteps steps={runGuide.backendSteps} emptyText="未根据规则识别到后端启动步骤。" />
              </RunGuideSection>
              <RunGuideSection title="前端启动步骤">
                <RunGuideSteps steps={runGuide.frontendSteps} emptyText="未根据规则识别到前端启动步骤。" />
              </RunGuideSection>
              <RunGuideSection title="注意事项">
                <RunGuideWarnings warnings={runGuide.warnings} />
              </RunGuideSection>
            </div>
          ) : (
            <p className="muted">暂无项目运行指南，请重新分析该仓库。</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function FavoriteRow({
  favorite,
  onOpen,
  onUnfavorite
}: {
  favorite: FavoriteRepository;
  onOpen: (recordId: string) => void;
  onUnfavorite: (recordId: string) => void;
}) {
  return (
    <div className="favorite-row">
      <div>
        <strong>{favorite.repoName}</strong>
        <a href={favorite.repoUrl} target="_blank" rel="noreferrer">
          {favorite.repoUrl}
        </a>
        <span className="favorite-time">收藏时间：{formatFullDate(favorite.favoritedAt)}</span>
      </div>
      <ProfileChips values={[...favorite.projectTypes, ...favorite.techStack].slice(0, 6)} emptyText="未识别技术栈" />
      <div className="favorite-actions">
        <button type="button" onClick={() => onOpen(favorite.analysisRecordId)}>
          <Eye size={15} />
          查看详情
        </button>
        <button type="button" className="danger" onClick={() => onUnfavorite(favorite.analysisRecordId)}>
          <Star size={15} />
          取消收藏
        </button>
      </div>
    </div>
  );
}

function PersonalCenter({
  user,
  onUserChange,
  onReanalyzeRepo,
  onLogout
}: {
  user: UserSession;
  onUserChange: (user: UserSession) => void;
  onReanalyzeRepo: (repoUrl: string) => void;
  onLogout: () => void;
}) {
  const [data, setData] = useState<PersonalCenterData | undefined>();
  const [detail, setDetail] = useState<ReportDetail | undefined>();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [name, setName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  async function loadProfile() {
    setLoadingProfile(true);
    setProfileError("");
    try {
      const payload = await requestJson<PersonalCenterData>("/api/profile");
      setData(payload);
      onUserChange(payload.user);
      setName(payload.user.name);
      setAvatarUrl(payload.user.avatarUrl ?? "");
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "个人中心加载失败");
    } finally {
      setLoadingProfile(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;
    let active = true;
    setCameraLoading(true);
    setCameraError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraLoading(false);
      setCameraError("当前浏览器不支持拍照，请选择本机图片。");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 960 }
        },
        audio: false
      })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          void cameraVideoRef.current.play();
        }
      })
      .catch(() => {
        if (active) {
          setCameraLoading(false);
          setCameraError("无法使用摄像头，请检查浏览器的摄像头权限。");
        }
      });

    return () => {
      active = false;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraOpen]);

  async function selectAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProfileError("");
    try {
      setAvatarUrl(await imageFileToAvatarDataUrl(file));
    } catch (imageError) {
      setProfileError(imageError instanceof Error ? imageError.message : "头像处理失败");
    }
  }

  function captureAvatar() {
    const video = cameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError("摄像头画面还没有准备好，请稍后再试。");
      return;
    }
    const canvas = document.createElement("canvas");
    const size = 320;
    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - sourceSize) / 2;
    const sourceY = (video.videoHeight - sourceSize) / 2;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("拍照失败，请重新尝试。");
      return;
    }
    context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    setAvatarUrl(canvas.toDataURL("image/jpeg", 0.84));
    setCameraOpen(false);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    try {
      const payload = await requestJson<{ user: UserSession }>("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, avatarUrl })
      });
      onUserChange(payload.user);
      setData((current) => current ? { ...current, user: payload.user } : current);
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "资料保存失败");
    } finally {
      setSavingProfile(false);
    }
  }

  async function openRecord(recordId: string) {
    setProfileError("");
    try {
      const payload = await requestJson<ReportDetail>(`/api/profile/analysis-records/${recordId}`);
      if (!payload.analysis && !payload.runGuide) {
        setProfileError("该记录没有可查看的分析详情，请重新分析。");
        return;
      }
      setDetail(payload);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "详情打开失败");
    }
  }

  async function deleteRecord(record: AnalysisRecord) {
    if (!window.confirm(`确定删除 ${record.repoName} 的分析记录吗？`)) return;
    setProfileError("");
    try {
      await requestJson<{ ok: boolean }>(`/api/profile/analysis-records/${record.id}`, { method: "DELETE" });
      await loadProfile();
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "删除失败");
    }
  }

  async function toggleFavorite(record: AnalysisRecord) {
    setProfileError("");
    try {
      await requestJson<{ record: AnalysisRecord }>(`/api/profile/analysis-records/${record.id}/favorite`, {
        method: record.favorite ? "DELETE" : "POST"
      });
      await loadProfile();
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "收藏操作失败");
    }
  }

  async function unfavoriteRecord(recordId: string) {
    setProfileError("");
    try {
      await requestJson<{ record: AnalysisRecord }>(`/api/profile/analysis-records/${recordId}/favorite`, { method: "DELETE" });
      await loadProfile();
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "取消收藏失败");
    }
  }

  async function downloadRecord(record: AnalysisRecord, format: ReportFormat) {
    setProfileError("");
    try {
      await downloadFile(`/api/reports/${record.id}/download?format=${format}`);
      await loadProfile();
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "下载失败");
    }
  }

  async function downloadAgain(record: DownloadRecord) {
    setProfileError("");
    try {
      await downloadFile(`/api/profile/downloads/${record.id}/file`);
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "再次下载失败");
    }
  }

  const profile = data?.user ?? user;
  const previewProfile = { ...profile, avatarUrl };
  const analysisCount = data?.analysisRecords.length ?? 0;
  const favoriteCount = data?.favorites.length ?? 0;
  const downloadCount = data?.downloadRecords.length ?? 0;

  function scrollToHistory() {
    document.getElementById("profile-history-records")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (detail) {
    return (
      <main className="profile-page">
        {profileError ? (
          <div className="top-error profile-error">
            <CircleAlert size={18} />
            <span>{profileError}</span>
          </div>
        ) : null}
        <ReportDetailPreview detail={detail} onBack={() => setDetail(undefined)} onDownload={downloadRecord} />
      </main>
    );
  }

  return (
    <main className="profile-page">
      <section className="profile-hero panel">
        <div className="profile-identity">
          <ProfileAvatar user={previewProfile} size="large" />
          <div>
            <span>个人中心</span>
            <h2>{profile.name}</h2>
            <p>{profile.role} · {profile.team}</p>
            <div className="profile-submeta">
              <span>
                <Mail size={13} />
                {profile.email}
              </span>
              <span>
                <CalendarClock size={13} />
                注册于 {formatDateOnly(profile.registeredAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="profile-facts">
          <div>
            <span>分析仓库数</span>
            <strong>{formatCount(analysisCount)}</strong>
          </div>
          <div>
            <span>收藏仓库数</span>
            <strong>{formatCount(favoriteCount)}</strong>
          </div>
          <div>
            <span>下载报告数</span>
            <strong>{formatCount(downloadCount)}</strong>
          </div>
          <div>
            <span>最近登录</span>
            <strong>{formatFullDate(profile.lastLoginAt)}</strong>
          </div>
        </div>
      </section>

      {profileError ? (
        <div className="top-error profile-error">
          <CircleAlert size={18} />
          <span>{profileError}</span>
        </div>
      ) : null}

      <div className="profile-grid">
        <Panel title="账号设置" icon={<Settings size={18} />} className="profile-settings-panel">
          <form className="profile-settings" onSubmit={saveProfile}>
            <div className="avatar-setting">
              <ProfileAvatar user={previewProfile} size="large" />
              <div>
                <strong>个人头像</strong>
                <span>支持 JPG、PNG、WebP，图片会自动裁剪为正方形。</span>
                <div className="avatar-setting-actions">
                  <button type="button" onClick={() => avatarFileInputRef.current?.click()}>
                    <ImagePlus size={15} />
                    选择图片
                  </button>
                  <button type="button" onClick={() => setCameraOpen(true)}>
                    <Camera size={15} />
                    拍照
                  </button>
                  {avatarUrl ? (
                    <button type="button" className="danger" onClick={() => setAvatarUrl("")}>
                      <Trash2 size={15} />
                      移除头像
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                ref={avatarFileInputRef}
                className="visually-hidden-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={selectAvatar}
              />
            </div>
            <label>
              <span>用户名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入用户名" />
            </label>
            <div className="profile-settings-actions">
              <button type="submit" disabled={savingProfile}>
                {savingProfile ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                保存资料
              </button>
              <button type="button" onClick={onLogout}>
                <LogOut size={16} />
                退出登录
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="收藏仓库" icon={<Star size={18} />} className="profile-favorites-panel">
          {loadingProfile ? (
            <p className="muted">正在加载收藏列表。</p>
          ) : data?.favorites.length ? (
            <div className="favorite-list">
              {data.favorites.map((favorite) => (
                <FavoriteRow key={favorite.id} favorite={favorite} onOpen={openRecord} onUnfavorite={unfavoriteRecord} />
              ))}
            </div>
          ) : (
            <p className="muted">还没有收藏仓库，可以在历史分析记录里点击收藏。</p>
          )}
        </Panel>

        <Panel title="历史分析记录" icon={<CalendarClock size={18} />} className="profile-history-panel">
          <div id="profile-history-records" />
          {loadingProfile ? (
            <div className="profile-loading">
              <Loader2 size={18} className="spin" />
              正在加载历史记录
            </div>
          ) : data?.analysisRecords.length ? (
            <div className="profile-record-list">
              {data.analysisRecords.map((record) => (
                <AnalysisRecordCard
                  key={record.id}
                  record={record}
                  onOpen={(item) => openRecord(item.id)}
                  onReanalyze={(item) => onReanalyzeRepo(item.repoUrl)}
                  onDelete={deleteRecord}
                  onToggleFavorite={toggleFavorite}
                  onDownload={downloadRecord}
                />
              ))}
            </div>
          ) : (
            <p className="muted">暂无分析记录。回到首页分析一个 GitHub 仓库后，这里会自动记录。</p>
          )}
        </Panel>

        <Panel title="下载记录" icon={<Download size={18} />} className="profile-downloads-panel">
          {loadingProfile ? (
            <p className="muted">正在加载下载记录。</p>
          ) : data?.downloadRecords.length ? (
            <div className="download-list">
              {data.downloadRecords.map((record) => (
                <DownloadRecordRow key={record.id} record={record} onDownload={downloadAgain} />
              ))}
            </div>
          ) : (
            <div className="download-empty">
              <FileDown size={22} />
              <div>
                <strong>暂无下载记录</strong>
                <p>在历史分析记录里下载 Markdown 或 PDF 报告后，会自动出现在这里。</p>
              </div>
              <button type="button" onClick={scrollToHistory}>
                去下载报告
              </button>
            </div>
          )}
        </Panel>
      </div>

      {cameraOpen ? (
        <div className="camera-dialog-backdrop" role="presentation" onMouseDown={() => setCameraOpen(false)}>
          <section className="camera-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="camera-dialog-head">
              <div>
                <span>头像拍摄</span>
                <h2 id="camera-dialog-title">拍摄个人头像</h2>
              </div>
              <button type="button" onClick={() => setCameraOpen(false)} aria-label="关闭拍照">
                <XCircle size={19} />
              </button>
            </div>
            <div className="camera-preview">
              <video
                ref={cameraVideoRef}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={() => setCameraLoading(false)}
              />
              {cameraLoading ? (
                <div className="camera-status">
                  <Loader2 size={22} className="spin" />
                  正在打开摄像头
                </div>
              ) : null}
              {cameraError ? (
                <div className="camera-status error">
                  <CircleAlert size={22} />
                  {cameraError}
                </div>
              ) : null}
            </div>
            <div className="camera-dialog-actions">
              <button type="button" onClick={() => setCameraOpen(false)}>
                取消
              </button>
              <button type="button" onClick={captureAvatar} disabled={cameraLoading || Boolean(cameraError)}>
                <Camera size={16} />
                使用照片
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<UserSession | undefined>();
  const [checkingSession, setCheckingSession] = useState(true);
  const [repoUrl, setRepoUrl] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | undefined>();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [activePage, setActivePage] = useState<"workspace" | "profile">("workspace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const analyzeControllerRef = useRef<AbortController | null>(null);
  const analyzeRequestIdRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    requestJson<AuthResponse>("/api/auth/me")
      .then((payload) => {
        if (mounted) {
          setUser(payload.user);
        }
      })
      .catch(() => {
        if (mounted) {
          setUser(undefined);
        }
      })
      .finally(() => {
        if (mounted) {
          setCheckingSession(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function login(email: string, password: string, remember: boolean) {
    const payload = await requestJson<AuthResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember })
    });
    setUser(payload.user);
    setActivePage("workspace");
  }

  async function register(name: string, email: string, password: string) {
    const payload = await requestJson<AuthResponse>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    setUser(payload.user);
    setRepoUrl("");
    setAnalysis(undefined);
    setActiveTab("overview");
    setActivePage("workspace");
    setError("");
  }

  async function logout() {
    if (loading) {
      cancelAnalyze();
    }
    try {
      await requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(undefined);
      setRepoUrl("");
      setAnalysis(undefined);
      setActiveTab("overview");
      setActivePage("workspace");
      setError("");
    }
  }

  async function runAnalyze(targetUrl: string) {
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl) return;
    const controller = new AbortController();
    const requestId = analyzeRequestIdRef.current + 1;
    analyzeRequestIdRef.current = requestId;
    analyzeControllerRef.current = controller;
    setActivePage("workspace");
    setRepoUrl(trimmedUrl);
    setLoading(true);
    setError("");
    setAnalysis(undefined);
    try {
      const result = await requestJson<AnalysisResult>("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: trimmedUrl }),
        signal: controller.signal
      });
      if (controller.signal.aborted || analyzeRequestIdRef.current !== requestId) {
        return;
      }
      setAnalysis(result);
      setActiveTab("overview");
    } catch (requestError) {
      if (controller.signal.aborted || analyzeRequestIdRef.current !== requestId) {
        setAnalysis(undefined);
      } else {
        setError(requestError instanceof Error ? requestError.message : "分析失败");
      }
    } finally {
      if (analyzeControllerRef.current === controller) {
        analyzeControllerRef.current = null;
      }
      if (analyzeRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    await runAnalyze(repoUrl);
  }

  function cancelAnalyze() {
    analyzeRequestIdRef.current += 1;
    analyzeControllerRef.current?.abort();
    analyzeControllerRef.current = null;
    setLoading(false);
    setAnalysis(undefined);
    setActiveTab("overview");
    setActivePage("workspace");
    setError("");
  }

  function goHome() {
    if (loading) {
      cancelAnalyze();
      return;
    }
    setActivePage("workspace");
    setAnalysis(undefined);
    setActiveTab("overview");
    setError("");
  }

  function returnToAnalysisPage() {
    setActivePage("workspace");
    setActiveTab("overview");
    setError("");
  }

  function openProfile() {
    if (loading) {
      cancelAnalyze();
    }
    setActivePage("profile");
    setError("");
  }

  const isHome = activePage === "workspace" && !loading && !analysis;

  if (checkingSession) {
    return <AuthLoading />;
  }

  if (!user) {
    return <LoginPage onLogin={login} onRegister={register} />;
  }

  return (
    <div className={["app-shell", isHome ? "home-shell" : ""].filter(Boolean).join(" ")}>
      <header className={["topbar", isHome ? "home-topbar" : ""].filter(Boolean).join(" ")}>
        <button type="button" className="brand brand-button" onClick={goHome} aria-label="返回首页">
          <SearchCode size={24} />
          <div>
            <h1>代码仓库智能导览器</h1>
          </div>
        </button>
        <div className="user-menu" aria-label="当前用户">
          <ProfileAvatar user={user} />
          <div className="user-copy">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button type="button" onClick={openProfile} title="个人中心" aria-label="个人中心">
            <UserRound size={16} />
          </button>
          <button type="button" onClick={logout} title="退出登录" aria-label="退出登录">
            <LogOut size={16} />
          </button>
        </div>
        {activePage === "profile" ? (
          <button type="button" className="analysis-home-button" onClick={returnToAnalysisPage}>
            <SearchCode size={18} />
            <span>回到分析主页</span>
          </button>
        ) : (
          <form className={["repo-form", isHome ? "home-repo-form" : ""].filter(Boolean).join(" ")} onSubmit={analyze}>
            <Github size={18} />
            <input
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !repoUrl.trim()} title={loading ? "正在分析" : "分析仓库"}>
              {loading ? <Loader2 size={18} className="spin" /> : <GitBranch size={18} />}
              <span>{loading ? "分析中" : "分析"}</span>
            </button>
          </form>
        )}
      </header>

      {error ? (
        <div className="top-error">
          <CircleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {activePage === "profile" ? (
        <PersonalCenter
          user={user}
          onUserChange={setUser}
          onReanalyzeRepo={(url) => {
            void runAnalyze(url);
          }}
          onLogout={logout}
        />
      ) : (
        <>
          {loading ? <LoadingState onCancel={cancelAnalyze} /> : null}

          {!loading && analysis ? (
            <AnalysisWorkspace analysis={analysis} activeTab={activeTab} onTabChange={setActiveTab} />
          ) : null}

          {!loading && !analysis ? (
            <HomeLanding onSelectSample={(url) => {
              setRepoUrl(url);
              setError("");
            }} />
          ) : null}
        </>
      )}
    </div>
  );
}

