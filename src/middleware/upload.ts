import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';

const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/mp4',     // .m4a (iOS Voice Memos, most browsers)
  'audio/x-m4a',   // .m4a (some Windows browsers)
  'audio/aac',     // .m4a (occasional)
]);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);

export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (AUDIO_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('UNSUPPORTED_MIME'));
  },
}).single('file');

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('UNSUPPORTED_MIME'));
  },
}).single('file');

/**
 * Wraps a multer middleware so its errors return clean JSON
 * with our error code shape instead of crashing.
 */
export function handleUpload(middleware: typeof audioUpload) {
  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds size limit' } });
          return;
        }
        res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
        return;
      }
      if (err instanceof Error && err.message === 'UNSUPPORTED_MIME') {
        res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'File type not allowed' } });
        return;
      }
      if (err) {
        next(err);
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: { code: 'MISSING_FILE', message: 'No file uploaded under field "file"' } });
        return;
      }
      next();
    });
  };
}
