export type NodeType = "file" | "directory";

export interface TreeNode {
  name: string;
  path: string;
  type: NodeType;
  children?: TreeNode[];
  truncated?: boolean;
}

export interface TechItem {
  name: string;
  category: string;
  evidence: string[];
}

export interface RunStep {
  label: string;
  command: string;
  cwd?: string;
  note?: string;
}

export interface ModuleSummary {
  name: string;
  path: string;
  kind: string;
  description: string;
  keyFiles: string[];
}

export interface RouteInfo {
  method: string;
  route: string;
  file: string;
  line: number;
  handler?: string;
  group?: string;
  description?: string;
}

export interface PageInfo {
  route: string;
  file: string;
  framework?: string;
  name?: string;
  description?: string;
}

export interface DatabaseInfo {
  kind: string;
  file: string;
  line?: number;
  name?: string;
  description?: string;
  columns?: Array<{
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
  }>;
  primaryKey?: string[];
  foreignKeys?: Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}

export interface FileReference {
  file: string;
  line?: number;
  preview?: string;
  reason?: string;
  score?: number;
}

export interface AnalysisResult {
  repoId: string;
  repoUrl: string;
  repoName: string;
  analyzedAt: string;
  tree: TreeNode;
  stats: {
    files: number;
    directories: number;
    scannedFiles: number;
    totalBytes: number;
  };
  techStack: TechItem[];
  summary: string;
  overview: {
    purpose: string;
    practicalUses: string[];
    codeFocus: string;
    scanExplanation: string;
  };
  runSteps: RunStep[];
  modules: ModuleSummary[];
  routes: RouteInfo[];
  pages: PageInfo[];
  database: DatabaseInfo[];
  notableFiles: FileReference[];
}

export interface RunGuideResponse {
  projectTypes: string[];
  environments: string[];
  databaseFiles: string[];
  configFiles: string[];
  configItems: {
    serverPort?: string;
    databaseUrl?: string;
    databaseUsername?: string;
    databasePassword?: string;
    redisHost?: string;
    redisPort?: string;
    backendApiUrl?: string;
    frontendPort?: string;
  };
  backendSteps: string[];
  frontendSteps: string[];
  warnings: string[];
}

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
}

export interface DownloadRecord {
  id: string;
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
