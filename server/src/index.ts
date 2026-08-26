import express from "express";
import cors from "cors";
import { mkdirSync } from "node:fs";
import { initDataStore } from "./store";
import { LOCAL_UPLOADS_DIR } from "./storage/localProvider";
import usersRouter from "./routes/users";
import messagesRouter from "./routes/messages";
import uploadRouter from "./routes/upload";

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/v1/users', usersRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/upload', uploadRouter);

// STORAGE_PROVIDER=local 时媒体文件从此处暴露（express.static 自带 Range 支持，视频可拖进度条）
mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
app.use('/media', express.static(LOCAL_UPLOADS_DIR));

initDataStore()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}/`);
    });
  })
  .catch((e) => {
    console.error('[server] data store init failed:', e);
    process.exit(1);
  });
