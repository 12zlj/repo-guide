-- 代码仓库智能导览器 - 个人中心数据库表设计
-- 适用于 MySQL 8.x。当前 MVP 使用内存存储，正式落库时可按此结构迁移。

CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  username VARCHAR(60) NOT NULL,
  avatar_url VARCHAR(500),
  role VARCHAR(60) NOT NULL DEFAULT '项目分析师',
  team VARCHAR(120),
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE repository_analysis_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  repo_id VARCHAR(160) NOT NULL,
  repo_name VARCHAR(200) NOT NULL,
  repo_url VARCHAR(500) NOT NULL,
  project_types JSON,
  tech_stack JSON,
  summary TEXT,
  status ENUM('success', 'failed') NOT NULL DEFAULT 'success',
  error_message TEXT,
  analysis_snapshot JSON,
  run_guide_snapshot JSON,
  analyzed_at DATETIME NOT NULL,
  favorite_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_analysis_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_analysis_user_time (user_id, analyzed_at DESC),
  INDEX idx_analysis_repo_url (repo_url)
);

CREATE TABLE repository_favorites (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  analysis_record_id BIGINT NOT NULL,
  repo_name VARCHAR(200) NOT NULL,
  repo_url VARCHAR(500) NOT NULL,
  favorited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_favorite_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_favorite_analysis FOREIGN KEY (analysis_record_id) REFERENCES repository_analysis_records(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_analysis_favorite (user_id, analysis_record_id),
  INDEX idx_favorite_user_time (user_id, favorited_at DESC)
);

CREATE TABLE report_download_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  analysis_record_id BIGINT NOT NULL,
  report_name VARCHAR(240) NOT NULL,
  repo_name VARCHAR(200) NOT NULL,
  download_format ENUM('markdown', 'pdf') NOT NULL,
  downloaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_download_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_download_analysis FOREIGN KEY (analysis_record_id) REFERENCES repository_analysis_records(id) ON DELETE CASCADE,
  INDEX idx_download_user_time (user_id, downloaded_at DESC)
);
