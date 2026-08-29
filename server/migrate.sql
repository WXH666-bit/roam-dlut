-- Here · MySQL 当前表结构（适合新库一键执行）
-- 存量库缺列由 server/src/store/mysqlStore.ts 的 init() 检查并补齐；字符集 utf8mb4 支持贴纸占位符与表情

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
  media_type ENUM('none','image','video','audio') NOT NULL DEFAULT 'none',
  media_key VARCHAR(512) NULL COMMENT '对象存储 key，读取时实时生成签名 URL',
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  coordinate_system VARCHAR(16) NULL COMMENT '规范坐标系；新发布统一为 wgs84，NULL 表示旧 API 隐含 WGS-84',
  accuracy DOUBLE NULL COMMENT '设备报告的水平定位精度（米）',
  captured_at BIGINT NULL COMMENT '设备获取定位的毫秒时间戳',
  created_at BIGINT NOT NULL COMMENT '毫秒时间戳',
  moderation_status ENUM('published','pending') NOT NULL DEFAULT 'published' COMMENT '普通接口只返回 published',
  moderation_model VARCHAR(64) NULL,
  moderation_verdict ENUM('safe','review','error') NULL,
  moderation_severity ENUM('low','medium','high','critical') NULL,
  moderation_reason VARCHAR(500) NULL COMMENT '仅管理员可见，不返回普通客户端',
  moderation_categories TEXT NULL COMMENT 'JSON 字符串数组',
  moderation_requested_at BIGINT NULL,
  moderation_decided_at BIGINT NULL,
  INDEX idx_messages_device (device_id),
  INDEX idx_messages_created (created_at),
  INDEX idx_messages_moderation (moderation_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 存量库升级（服务端 init() 会逐列检查并安全补齐；普通用户坐标不会被改写）：
-- ALTER TABLE messages ADD COLUMN coordinate_system VARCHAR(16) NULL;
-- ALTER TABLE messages ADD COLUMN accuracy DOUBLE NULL;
-- ALTER TABLE messages ADD COLUMN captured_at BIGINT NULL;
-- ALTER TABLE messages MODIFY COLUMN media_type ENUM('none','image','video','audio') NOT NULL DEFAULT 'none';
-- 审核列由新版服务端 init() 自动补齐；旧消息会通过 DEFAULT 保持 published。
-- 仅 seed-device 下固定的 seed-01…seed-40 会由服务端一次性从 GCJ-02 转为 WGS-84。

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

-- 管理员审核日志不保留被删除的正文/媒体，只记录决策元数据。
CREATE TABLE IF NOT EXISTS moderation_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(32) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  decision ENUM('approve','reject') NOT NULL,
  reviewer_id VARCHAR(64) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_moderation_review_message (message_id),
  INDEX idx_moderation_reviews_device (device_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 拒绝内容的媒体清理任务：审核事务只删除消息记录，实际对象删除失败时
-- 保留 media_key，供管理员/后台任务重试；成功后将 media_key 清空。
CREATE TABLE IF NOT EXISTS media_cleanup_tasks (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  message_id VARCHAR(32) NOT NULL,
  media_key VARCHAR(512) NULL,
  attempt INT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(500) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_media_cleanup_message (message_id),
  INDEX idx_media_cleanup_pending (media_key, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 已上传但尚未被留言认领的临时媒体；过期后由后台清理对象并删除登记。
-- media_key 同时作为一次性认领的幂等键，认领与消息插入在同一事务内完成。
CREATE TABLE IF NOT EXISTS media_uploads (
  media_key VARCHAR(512) NOT NULL PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  media_type ENUM('image','video','audio') NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(500) NULL,
  updated_at BIGINT NOT NULL,
  cleanup_lease_until BIGINT NULL,
  INDEX idx_media_uploads_expiry (expires_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 只在管理员确认违规后增加 violation_count；模型判断本身不会封禁。
CREATE TABLE IF NOT EXISTS device_moderation (
  device_id VARCHAR(64) NOT NULL PRIMARY KEY,
  violation_count INT UNSIGNED NOT NULL DEFAULT 0,
  banned_until BIGINT NULL,
  permanent TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_device_moderation_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 通知事件：id 是全局单调游标，客户端只拿事件类型和留言 id，不返回正文或坐标
CREATE TABLE IF NOT EXISTS notification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  recipient_device_id VARCHAR(64) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL COMMENT '毫秒时间戳',
  INDEX idx_notification_events_recipient_id (recipient_device_id, id),
  INDEX idx_notification_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 事务内锁定这一行后再分配事件 id，保证游标顺序与提交顺序一致。
CREATE TABLE IF NOT EXISTS notification_event_sequence (
  singleton TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  next_id BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO notification_event_sequence (singleton, next_id)
SELECT 1, COALESCE(MAX(id), 0) + 1 FROM notification_events
ON DUPLICATE KEY UPDATE next_id = GREATEST(next_id, VALUES(next_id));

-- Expo 推送 token：同一身份可绑定多个安装实例
CREATE TABLE IF NOT EXISTS push_tokens (
  device_id VARCHAR(64) NOT NULL,
  token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at BIGINT NOT NULL COMMENT '毫秒时间戳',
  PRIMARY KEY (token),
  INDEX idx_push_tokens_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 先清除旧版本曾接受的非法 token，避免非 ASCII 数据阻断下面的列转换。
-- BINARY 强制区分大小写；格式与服务端运行时校验保持一致。
DELETE FROM push_tokens
WHERE token IS NULL OR NOT (
  BINARY token REGEXP BINARY
  CONCAT(
    '^((ExponentPushToken|ExpoPushToken)', CHAR(92), '[',
    '[!-~]{1,480}', CHAR(92), ']',
    '|[A-Za-z0-9]{8}(-[A-Za-z0-9]{4}){3}-[A-Za-z0-9]{12})$'
  )
);

-- 存量表升级为大小写敏感比较；重复执行安全。
ALTER TABLE push_tokens
  MODIFY token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- 兼容曾使用 (device_id, token) 复合主键的试验库：同一物理 token 只保留最新身份。
DELETE older FROM push_tokens AS older
INNER JOIN push_tokens AS newer ON older.token = newer.token
  AND (
    older.updated_at < newer.updated_at OR
    (older.updated_at = newer.updated_at AND older.device_id < newer.device_id)
  );

ALTER TABLE push_tokens
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (token);
