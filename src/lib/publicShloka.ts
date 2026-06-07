import type { ShlokaDoc } from '../models/Shloka.js';

export interface PublicWordTiming {
  text: string;
  start: number;
  end: number;
}

export interface PublicShlokaLine {
  sanskrit: string;
  words: PublicWordTiming[];
  fullTimings: PublicWordTiming[];
}

export interface PublicShlokaAsset {
  url: string;
  publicId?: string; // present only in admin responses
}

export interface PublicShloka {
  id: string;
  slug: string;
  title: string;
  meaning: string;
  fullText?: string;
  highlightWords?: string[];
  caseStudy?: string;
  reference?: string;
  status: 'draft' | 'published';
  audio: {
    full: PublicShlokaAsset;
    lines: PublicShlokaAsset[];
  };
  image?: PublicShlokaAsset;
  lines: PublicShlokaLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ToPublicOpts {
  includePublicIds?: boolean; // admin responses set true
}

export function toPublicShloka(doc: ShlokaDoc, opts: ToPublicOpts = {}): PublicShloka {
  const includeIds = opts.includePublicIds ?? false;
  const mapAsset = (a: { url: string; publicId: string }): PublicShlokaAsset =>
    includeIds ? { url: a.url, publicId: a.publicId } : { url: a.url };

  return {
    id: doc._id.toString(),
    slug: doc.slug,
    title: doc.title,
    meaning: doc.meaning,
    fullText: doc.fullText ?? undefined,
    highlightWords: doc.highlightWords ?? [],
    caseStudy: doc.caseStudy ?? undefined,
    reference: doc.reference ?? undefined,
    status: doc.status as 'draft' | 'published',
    audio: {
      full: mapAsset(doc.audio.full),
      lines: (doc.audio.lines ?? []).map(mapAsset),
    },
    image: doc.image ? mapAsset(doc.image) : undefined,
    lines: doc.lines.map((l) => ({
      sanskrit: l.sanskrit,
      words: l.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
      fullTimings: l.fullTimings.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    })),
    createdAt: (doc.createdAt as Date).toISOString(),
    updatedAt: (doc.updatedAt as Date).toISOString(),
  };
}
