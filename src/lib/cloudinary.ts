import { v2 as cloudinary } from 'cloudinary';
import { env } from '../env.js';

export interface UploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  duration?: number;
}

let configured = false;
function ensureConfig(): void {
  if (configured) return;
  const e = env();
  cloudinary.config({
    cloud_name: e.CLOUDINARY_CLOUD_NAME,
    api_key: e.CLOUDINARY_API_KEY,
    api_secret: e.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export async function uploadBuffer(
  buf: Buffer,
  folder: string,
  resourceType: 'image' | 'video',
): Promise<UploadResult> {
  ensureConfig();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error('Cloudinary returned no result'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          duration: result.duration,
        });
      },
    );
    stream.end(buf);
  });
}

export async function deleteAsset(publicId: string, resourceType: 'image' | 'video'): Promise<void> {
  ensureConfig();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
