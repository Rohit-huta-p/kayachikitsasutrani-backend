import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri);
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

export function mongoStateLabel(): 'disconnected' | 'connected' | 'connecting' | 'disconnecting' {
  const s = mongoose.connection.readyState;
  if (s === 1) return 'connected';
  if (s === 2) return 'connecting';
  if (s === 3) return 'disconnecting';
  return 'disconnected';
}
