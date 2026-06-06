# 代码仓库智能导览器

输入一个 GitHub 仓库地址，系统会拉取并扫描源码，生成便于理解的项目导览，包括项目用途、目录结构、技术栈、核心模块、接口与页面、数据库结构和项目运行向导。

## 主要功能

- GitHub 仓库拉取与目录树生成
- React、Vue、Spring Boot、Node.js、Python、Docker 等技术栈识别
- 项目用途、核心模块与关键文件说明
- 后端接口、前端页面和数据库结构分析
- 基于仓库配置文件生成项目运行向导
- 登录、注册和个人中心
- 历史分析、收藏仓库与报告下载
- Markdown、PDF 分析报告下载
- 当前仓库源码 ZIP 下载

## 技术栈

- 前端：React、TypeScript、Vite、Lucide React
- 后端：Express、TypeScript
- 仓库处理：Git、GitHub ZIP 回退、AdmZip、Archiver
- 报告生成：PDFKit

## 本地运行

需要安装 Node.js 18+ 和 Git。

```bash
npm install
npm run dev
```

启动后访问：

```text
http://127.0.0.1:4174/
```

## 构建

```bash
npm run typecheck
npm run build
npm start
```

## 演示账号

```text
邮箱：demo@repoguide.dev
密码：RepoGuide@123
```

演示账号仅用于本地 MVP 功能体验。正式部署时应接入持久化数据库、密码哈希、正式会话存储和访问权限控制。

## 项目结构

```text
server/     Express 后端、仓库分析与报告生成
src/        React 前端
public/     页面视觉资源
docs/       数据库表设计
```

## 说明

仓库源码会缓存在本地 `.repos` 目录，该目录不会提交到 GitHub。项目运行向导使用规则扫描生成，不调用大模型 API。
