import { Router } from 'express';
import { audioUpload, imageUpload, handleUpload } from '../../middleware/upload.js';
import { uploadBuffer } from '../../lib/cloudinary.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';

export const adminUploadsRouter = Router();

adminUploadsRouter.post('/audio', requireAuth, requireRole('admin'), handleUpload(audioUpload), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { code: 'MISSING_FILE', message: 'No file' } });
      return;
    }
    const result = await uploadBuffer(req.file.buffer, 'shlokas/audio', 'video');
    res.json({
      url: result.url,
      publicId: result.publicId,
      duration: result.duration,
    });
  } catch (err) {
    next(err);
  }
});

adminUploadsRouter.post('/image', requireAuth, requireRole('admin'), handleUpload(imageUpload), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { code: 'MISSING_FILE', message: 'No file' } });
      return;
    }
    const result = await uploadBuffer(req.file.buffer, 'shlokas/images', 'image');
    res.json({
      url: result.url,
      publicId: result.publicId,
      width: result.width,
      height: result.height,
    });
  } catch (err) {
    next(err);
  }
});
