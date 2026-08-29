import "dotenv/config";
import express from "express";
import cors from "cors";
import { mkdirSync } from "node:fs";
import { initDataStore } from "./store";
import { LOCAL_UPLOADS_DIR, localMediaRequestValid } from "./storage/localProvider";
import usersRouter from "./routes/users";
import messagesRouter from "./routes/messages";
import uploadRouter from "./routes/upload";
import updatesRouter from "./routes/updates";
import notificationsRouter from "./routes/notifications";
import adminRouter from "./routes/admin";
import { ADMIN_MODERATION_PAGE } from "./adminPage";
import { resumePendingModeration } from "./moderationWorkflow";
import { retryMediaCleanupTasks } from "./mediaCleanup";
import { retryExpiredMediaUploads } from "./mediaUploadCleanup";

const app = express();
const port = process.env.PORT || 9091;

const mediaCleanupIntervalMs = (): number => {
  const configured = Number(process.env.MEDIA_CLEANUP_INTERVAL_MS);
  return Number.isSafeInteger(configured) && configured >= 60_000
    ? Math.min(configured, 24 * 60 * 60 * 1000)
    : 15 * 60 * 1000;
};

// Enable only when the service is reachable exclusively through one trusted
// reverse proxy; otherwise a caller could forge X-Forwarded-For.
if (process.env.RATE_LIMIT_TRUST_PROXY === 'true') app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/admin/moderation', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: http: https:; media-src 'self' data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  );
  res.type('html').send(ADMIN_MODERATION_PAGE);
});

app.use('/api/v1/users', usersRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/updates', updatesRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/admin', adminRouter);

// STORAGE_PROVIDER=local 时使用 7 天签名 URL 暴露媒体；express.static 保留 Range 支持。
mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
app.use('/media', (req, res, next) => {
  const key = req.path.replace(/^\/+/, '');
  if (!localMediaRequestValid(key, req.query.expires, req.query.signature)) {
    return res.status(404).json({ error: 'not_found' });
  }
  next();
}, express.static(LOCAL_UPLOADS_DIR));

initDataStore()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}/`);
      void resumePendingModeration()
        .then((count) => {
          if (count > 0) console.log(`[moderation] resumed ${count} unfinished job(s)`);
        })
        .catch((error) => console.error('[moderation] resume failed:', error));
      void retryMediaCleanupTasks()
        .then((summary) => {
          if (summary.attempted > 0) console.log('[moderation] media cleanup:', summary);
        })
        .catch((error) => console.error('[moderation] media cleanup resume failed:', error));
      void retryExpiredMediaUploads()
        .then((summary) => {
          if (summary.attempted > 0) console.log('[upload] expired media cleanup:', summary);
        })
        .catch((error) => console.error('[upload] cleanup resume failed:', error));
      const cleanupTimer = setInterval(() => {
        void Promise.all([retryMediaCleanupTasks(), retryExpiredMediaUploads()])
          .catch((error) => console.error('[media] scheduled cleanup failed:', error));
      }, mediaCleanupIntervalMs());
      cleanupTimer.unref();
    });
  })
  .catch((e) => {
    console.error('[server] data store init failed:', e);
    process.exit(1);
  });
