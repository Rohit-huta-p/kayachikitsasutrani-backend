/**
 * Dense-rank a list of items by the given comparator.
 *
 * Tied items (where `compare(a, b) === 0`) receive the same rank.
 * The next distinct item receives the *positional* rank (1-based),
 * not the next sequential rank — this matches the "1224" ranking
 * already used throughout the codebase.
 */
export function denseRank<T>(items: T[], compare: (a: T, b: T) => number): Map<T, number> {
  const sorted = [...items].sort(compare);
  const ranks = new Map<T, number>();
  let lastKey: T | null = null;
  let lastRank = 0;
  sorted.forEach((item, idx) => {
    if (lastKey !== null && compare(lastKey, item) === 0) {
      ranks.set(item, lastRank);
    } else {
      lastRank = idx + 1;
      ranks.set(item, lastRank);
      lastKey = item;
    }
  });
  return ranks;
}
