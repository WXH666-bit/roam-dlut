import express from "express";
import cors from "cors";
import { initDataStore } from "./store";
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
