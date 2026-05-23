const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (s.length < 1 || s.length > 80) return false;
  return SLUG_RE.test(s);
}
