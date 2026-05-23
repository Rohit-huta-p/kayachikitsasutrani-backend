import { vi } from 'vitest';

const uploadStreamMock = vi.fn((options, callback) => {
  return {
    end: (buf: Buffer) => {
      callback(null, {
        secure_url: `https://res.cloudinary.com/demo/${options.resource_type}/upload/${options.folder}/mock-${buf.length}`,
        public_id: `${options.folder}/mock-${Date.now()}`,
        width: options.resource_type === 'image' ? 800 : undefined,
        height: options.resource_type === 'image' ? 600 : undefined,
        duration: options.resource_type === 'video' ? 12.3 : undefined,
      });
    },
  };
});

const destroyMock = vi.fn(async () => ({ result: 'ok' }));

export const __mocks = { uploadStreamMock, destroyMock };

export const v2 = {
  config: vi.fn(),
  uploader: {
    upload_stream: uploadStreamMock,
    destroy: destroyMock,
  },
};
