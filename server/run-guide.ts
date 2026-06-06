import type { IndexedFile, RepoContext, RunGuideResponse, TreeNode } from "./types.js";

type ConfigItems = RunGuideResponse["configItems"];

const CONFIG_FILE_NAMES = new Set([".env", "package.json", "pom.xml"]);
const APPLICATION_CONFIG_PATTERN = /^application(?:-[\w.-]+)?\.(properties|ya?ml)$/i;
const SQL_PATTERN = /\.sql$/i;

function fileNameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function directoryOf(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "." : filePath.slice(0, index);
}

function displayDirectory(filePath: string | undefined): string {
  if (!filePath || filePath === ".") return "项目根目录";
  return filePath;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function collectTreeFilePaths(node: TreeNode): string[] {
  if (node.type === "file") return [node.path];
  return node.children?.flatMap((child) => collectTreeFilePaths(child)) ?? [];
}

function findFilesByName(files: IndexedFile[], name: string): IndexedFile[] {
  const lowerName = name.toLowerCase();
  return files.filter((file) => fileNameOf(file.path).toLowerCase() === lowerName);
}

function hasDependency(packageJson: IndexedFile, dependencyName: string): boolean {
  try {
    const parsed = JSON.parse(packageJson.content) as Record<string, unknown>;
    const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    return sections.some((section) => {
      const dependencies = parsed[section];
      return Boolean(
        dependencies &&
          typeof dependencies === "object" &&
          !Array.isArray(dependencies) &&
          Object.prototype.hasOwnProperty.call(dependencies, dependencyName)
      );
    });
  } catch {
    return packageJson.content.toLowerCase().includes(dependencyName.toLowerCase());
  }
}

function scriptsOf(packageJson: IndexedFile): Record<string, string> {
  try {
    const parsed = JSON.parse(packageJson.content) as Record<string, unknown>;
    const scripts = parsed.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return {};
    return Object.fromEntries(
      Object.entries(scripts as Record<string, unknown>).filter(([, value]) => typeof value === "string")
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function extractProperty(content: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertiesPattern = new RegExp(`(?:^|\\n)\\s*${escapedKey}\\s*[=:]\\s*([^\\r\\n#]+)`, "i");
  const propertiesMatch = content.match(propertiesPattern);
  if (propertiesMatch?.[1]) return propertiesMatch[1].trim();

  return extractYamlProperty(content, key);
}

function extractYamlProperty(content: string, key: string): string | undefined {
  const targetPath = key.toLowerCase();
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;

    const match = withoutComment.match(/^(\s*)([\w.-]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;

    const indent = match[1].length;
    const currentKey = match[2].toLowerCase();
    const value = match[3]?.trim();

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const fullPath = [...stack.map((item) => item.key), currentKey].join(".");
    if (value && fullPath === targetPath) {
      return value.replace(/^["']|["']$/g, "");
    }

    if (!value) {
      stack.push({ indent, key: currentKey });
    }
  }

  return undefined;
}

function extractEnvValue(content: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = content.match(new RegExp(`(?:^|\\n)\\s*${escapedKey}\\s*=\\s*([^\\r\\n#]+)`, "i"));
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function extractScriptPort(scripts: Record<string, string>): string | undefined {
  for (const script of Object.values(scripts)) {
    const portMatch = script.match(/(?:--port|-p)\s+(\d{2,5})/i);
    if (portMatch?.[1]) return portMatch[1];
  }
  return undefined;
}

function configFileCandidates(files: IndexedFile[]): IndexedFile[] {
  return files.filter((file) => {
    const name = fileNameOf(file.path);
    return CONFIG_FILE_NAMES.has(name) || APPLICATION_CONFIG_PATTERN.test(name);
  });
}

function collectConfigItems(configFiles: IndexedFile[], packageFiles: IndexedFile[]): ConfigItems {
  const items: ConfigItems = {};

  for (const file of configFiles) {
    const name = fileNameOf(file.path).toLowerCase();
    if (name.endsWith(".properties") || name.endsWith(".yml") || name.endsWith(".yaml")) {
      items.serverPort ??= extractProperty(file.content, "server.port");
      items.databaseUrl ??= extractProperty(file.content, "spring.datasource.url");
      items.databaseUsername ??= extractProperty(file.content, "spring.datasource.username");
      items.databasePassword ??= extractProperty(file.content, "spring.datasource.password");
      items.redisHost ??=
        extractProperty(file.content, "redis.host") ??
        extractProperty(file.content, "spring.redis.host") ??
        extractProperty(file.content, "spring.data.redis.host");
      items.redisPort ??=
        extractProperty(file.content, "redis.port") ??
        extractProperty(file.content, "spring.redis.port") ??
        extractProperty(file.content, "spring.data.redis.port");
    }

    if (name === ".env") {
      items.backendApiUrl ??= extractEnvValue(file.content, [
        "VITE_API_URL",
        "VITE_API_BASE_URL",
        "REACT_APP_API_URL",
        "REACT_APP_API_BASE_URL",
        "VUE_APP_API_URL",
        "VUE_APP_BASE_API",
        "API_URL",
        "BASE_API"
      ]);
      items.frontendPort ??= extractEnvValue(file.content, ["VITE_PORT", "PORT"]);
    }
  }

  for (const packageFile of packageFiles) {
    items.frontendPort ??= extractScriptPort(scriptsOf(packageFile));
  }

  return items;
}

function detectProjectTypes(files: IndexedFile[], allPaths: string[]): string[] {
  const packageFiles = findFilesByName(files, "package.json");
  const pomFiles = findFilesByName(files, "pom.xml");
  const hasRequirements = allPaths.some((filePath) => fileNameOf(filePath).toLowerCase() === "requirements.txt");
  const hasDocker = allPaths.some((filePath) => fileNameOf(filePath).toLowerCase() === "dockerfile");
  const types: string[] = [];

  if (pomFiles.some((file) => file.content.toLowerCase().includes("spring-boot"))) types.push("Spring Boot");
  if (pomFiles.length) types.push("Maven");
  if (packageFiles.some((file) => hasDependency(file, "vue"))) types.push("Vue");
  if (packageFiles.some((file) => hasDependency(file, "react"))) types.push("React");
  if (packageFiles.length) types.push("Node.js");
  if (hasRequirements) types.push("Python");
  if (hasDocker) types.push("Docker");

  return unique(types);
}

function detectEnvironments(projectTypes: string[], configItems: ConfigItems, databaseFiles: string[]): string[] {
  const environments: string[] = [];
  if (projectTypes.includes("Spring Boot") || projectTypes.includes("Maven")) environments.push("JDK", "Maven");
  if (projectTypes.includes("Vue") || projectTypes.includes("React") || projectTypes.includes("Node.js")) {
    environments.push("Node.js", "npm");
  }
  if (projectTypes.includes("Python")) environments.push("Python", "pip");
  if (projectTypes.includes("Docker")) environments.push("Docker");
  if (projectTypes.includes("Spring Boot") || configItems.databaseUrl?.toLowerCase().includes("mysql") || databaseFiles.length) {
    environments.push("MySQL");
  }
  if (configItems.redisHost || configItems.redisPort) environments.push("Redis");
  return unique(environments);
}

function findSpringPom(files: IndexedFile[]): IndexedFile | undefined {
  return findFilesByName(files, "pom.xml").find((file) => file.content.toLowerCase().includes("spring-boot"));
}

function findFrontendPackage(packageFiles: IndexedFile[]): IndexedFile | undefined {
  return (
    packageFiles.find((file) => hasDependency(file, "vue") || hasDependency(file, "react")) ??
    packageFiles.find((file) => directoryOf(file.path).toLowerCase().includes("frontend")) ??
    packageFiles[0]
  );
}

function findStaticFrontendDir(allPaths: string[]): string | undefined {
  const staticIndex = allPaths.find((filePath) => filePath.toLowerCase() === "frontend/index.html");
  if (staticIndex) return "frontend";
  return allPaths.find((filePath) => fileNameOf(filePath).toLowerCase() === "index.html") ? "." : undefined;
}

function generateBackendSteps(
  projectTypes: string[],
  files: IndexedFile[],
  databaseFiles: string[],
  configFiles: string[],
  configItems: ConfigItems
): string[] {
  const steps: string[] = [];
  const springPom = findSpringPom(files);

  if (projectTypes.includes("Spring Boot") && springPom) {
    const springDir = displayDirectory(directoryOf(springPom.path));
    const editableConfig =
      configFiles.find((file) => file.includes("application-mysql.properties")) ??
      configFiles.find((file) => file.endsWith("application.properties")) ??
      configFiles.find((file) => file.includes("application."));

    steps.push("安装 JDK 和 Maven");
    steps.push("启动 MySQL 服务");
    if (databaseFiles.length) {
      steps.push(`导入 ${databaseFiles[0]} 数据库文件`);
    }
    if (editableConfig) {
      steps.push(`修改 ${editableConfig} 中的数据库账号和密码`);
    }
    steps.push(`进入 ${springDir}`);
    steps.push("执行 mvn spring-boot:run");
    steps.push(`访问后端地址：http://localhost:${configItems.serverPort ?? "8080"}`);
    return steps;
  }

  const pom = findFilesByName(files, "pom.xml")[0];
  if (projectTypes.includes("Maven") && pom) {
    steps.push("安装 JDK 和 Maven");
    steps.push(`进入 ${displayDirectory(directoryOf(pom.path))}`);
    steps.push("执行 mvn clean package");
    steps.push("根据 README 或主类入口启动 Java 程序");
  }

  const requirements = findFilesByName(files, "requirements.txt")[0];
  if (projectTypes.includes("Python") && requirements) {
    steps.push("安装 Python 和 pip");
    steps.push(`进入 ${displayDirectory(directoryOf(requirements.path))}`);
    steps.push("执行 pip install -r requirements.txt");
    steps.push("根据 README 或 main.py / app.py 启动 Python 服务");
  }

  if (!steps.length && projectTypes.includes("Docker")) {
    steps.push("安装 Docker");
    steps.push("进入 Dockerfile 所在目录");
    steps.push("执行 docker build 构建镜像");
    steps.push("按 README 中的端口映射启动容器");
  }

  return unique(steps);
}

function generateFrontendSteps(files: IndexedFile[], allPaths: string[], configItems: ConfigItems): string[] {
  const packageFiles = findFilesByName(files, "package.json");
  const frontendPackage = findFrontendPackage(packageFiles);
  if (frontendPackage) {
    const scripts = scriptsOf(frontendPackage);
    const runScript = scripts.dev ? "dev" : scripts.serve ? "serve" : scripts.start ? "start" : "dev";
    const steps = [
      "安装 Node.js",
      `进入 ${displayDirectory(directoryOf(frontendPackage.path))}`,
      "执行 npm install",
      `执行 npm run ${runScript}`
    ];
    steps.push(configItems.frontendPort ? `打开前端页面：http://localhost:${configItems.frontendPort}` : "打开终端输出的前端页面访问地址");
    return steps;
  }

  const staticFrontendDir = findStaticFrontendDir(allPaths);
  if (staticFrontendDir) {
    return [
      `进入 ${displayDirectory(staticFrontendDir)}`,
      "使用浏览器打开 index.html",
      "或者使用 VS Code Live Server 插件运行前端页面"
    ];
  }

  return [];
}

function generateWarnings(
  projectTypes: string[],
  databaseFiles: string[],
  configItems: ConfigItems,
  backendSteps: string[],
  frontendSteps: string[]
): string[] {
  const warnings: string[] = [];
  const usesMySql =
    projectTypes.includes("Spring Boot") ||
    databaseFiles.length > 0 ||
    configItems.databaseUrl?.toLowerCase().includes("mysql");

  if (usesMySql) {
    warnings.push("请确认 MySQL 服务已启动");
    warnings.push("请确认数据库账号和密码正确");
  }
  if (databaseFiles.length) warnings.push("请先导入 SQL 文件");
  if (backendSteps.length && (configItems.serverPort || projectTypes.includes("Spring Boot"))) {
    warnings.push("请确认后端端口没有被占用");
  }
  if (frontendSteps.length && backendSteps.length) {
    warnings.push("请确认前端请求地址和后端端口一致");
  }
  if (configItems.redisHost || configItems.redisPort) {
    warnings.push("如果 Redis 配置存在，请确认 Redis 服务已启动");
  }
  if (projectTypes.includes("Docker")) {
    warnings.push("如果使用 Docker 运行，请确认 Docker 服务已启动");
  }

  return unique(warnings);
}

export function generateRunGuide(context: RepoContext): RunGuideResponse {
  const indexedPaths = context.files.map((file) => file.path);
  const treePaths = collectTreeFilePaths(context.result.tree);
  const allPaths = unique([...indexedPaths, ...treePaths]).sort((a, b) => a.localeCompare(b));
  const packageFiles = findFilesByName(context.files, "package.json");
  const databaseFiles = allPaths.filter((filePath) => SQL_PATTERN.test(filePath));
  const configFiles = unique([
    ...configFileCandidates(context.files).map((file) => file.path),
    ...allPaths.filter((filePath) => {
      const name = fileNameOf(filePath);
      return CONFIG_FILE_NAMES.has(name) || APPLICATION_CONFIG_PATTERN.test(name);
    })
  ]).sort((a, b) => a.localeCompare(b));
  const configItems = collectConfigItems(configFileCandidates(context.files), packageFiles);
  const projectTypes = detectProjectTypes(context.files, allPaths);
  const environments = detectEnvironments(projectTypes, configItems, databaseFiles);
  const backendSteps = generateBackendSteps(projectTypes, context.files, databaseFiles, configFiles, configItems);
  const frontendSteps = generateFrontendSteps(context.files, allPaths, configItems);
  const warnings = generateWarnings(projectTypes, databaseFiles, configItems, backendSteps, frontendSteps);

  return {
    projectTypes,
    environments,
    databaseFiles,
    configFiles,
    configItems,
    backendSteps,
    frontendSteps,
    warnings
  };
}
