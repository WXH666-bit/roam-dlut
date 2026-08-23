-- 此地有话 · MySQL 建表脚本（七牛云数据库一键执行）
-- 与 server/src/store/mysqlStore.ts 的 init() 等价；字符集 utf8mb4 支持贴纸占位符与表情

CREATE TABLE IF NOT EXISTS users (
  device_id VARCHAR(64) PRIMARY KEY,
  flower_name VARCHAR(32) NOT NULL,
  renamed TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  recovery_code VARCHAR(64) NULL COMMENT '三词暗号（身份找回唯一凭据，明文）'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 存量库升级：ALTER TABLE users ADD COLUMN recovery_code VARCHAR(64) NULL;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(32) PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  flower_name VARCHAR(32) NOT NULL,
  text VARCHAR(600) NOT NULL COMMENT '留言正文（140 字 + 贴纸占位符）',
  media_type ENUM('none','image','video') NOT NULL DEFAULT 'none',
  media_key VARCHAR(512) NULL COMMENT '对象存储 key，读取时实时生成签名 URL',
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  created_at BIGINT NOT NULL COMMENT '毫秒时间戳',
  INDEX idx_messages_device (device_id),
  INDEX idx_messages_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 阅读记录：按设备去重；剩余可读名额 = READ_LIMIT - 本表计数
CREATE TABLE IF NOT EXISTS message_readers (
  message_id VARCHAR(32) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  read_at BIGINT NOT NULL COMMENT '毫秒时间戳',
  PRIMARY KEY (message_id, device_id),
  INDEX idx_readers_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 点赞：设备去重、幂等
CREATE TABLE IF NOT EXISTS message_likes (
  message_id VARCHAR(32) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (message_id, device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
