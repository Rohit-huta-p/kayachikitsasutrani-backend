import { env } from '../env.js';

export interface WhisperWord {
  text: string;
  start: number;
  end: number;
}

export async function transcribeMeaningAudio(audioUrl: string): Promise<WhisperWord[]> {
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) return [];

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  const blob = new Blob([buf], { type: 'audio/mpeg' });

  const form = new FormData();
  form.append('file', blob, 'meaning.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whisper API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { words?: Array<{ word: string; start: number; end: number }> };
  return (data.words ?? []).map(w => ({ text: w.word.trim(), start: w.start, end: w.end }));
}
