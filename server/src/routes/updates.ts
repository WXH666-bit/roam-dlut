import { Router } from 'express';
import { otaStatus, serveAsset, serveManifest } from '../updates/protocol';

const router = Router();

router.get('/manifest', (req, res) => {
  void serveManifest(req, res);
});

router.get('/assets', (req, res) => {
  void serveAsset(req, res);
});

router.get('/health', (_req, res) => {
  void otaStatus()
    .then((status) => res.status(200).json(status))
    .catch((error) => {
      console.error('[ota] health failed:', error);
      res.status(500).json({ error: 'OTA storage unavailable.' });
    });
});

export default router;
