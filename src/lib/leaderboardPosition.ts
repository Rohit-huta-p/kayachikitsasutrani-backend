import { denseRank } from './denseRank.js';

interface RankableCompletion {
  userId: { toString(): string };
  completedAt: Date;
  elapsedSeconds: number;
  attempts: number;
}

/**
 * 1-based position of `userId` among one shloka's completions, ordered by
 * the average of the chronological, speed and fewest-attempts ranks (the
 * same ordering as the public leaderboard). 0 when the user isn't in `all`.
 */
export function leaderboardPosition<T extends RankableCompletion>(all: T[], userId: string): number {
  const chronoRanks = denseRank(all, (a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  const timeRanks = denseRank(all, (a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const attemptsRanks = denseRank(all, (a, b) => a.attempts - b.attempts);
  const avg = (c: T) => ((chronoRanks.get(c) || 0) + (timeRanks.get(c) || 0) + (attemptsRanks.get(c) || 0)) / 3;
  const sortedByAvg = [...all].sort((a, b) => {
    const diff = avg(a) - avg(b);
    if (diff !== 0) return diff;
    return a.completedAt.getTime() - b.completedAt.getTime();
  });
  return sortedByAvg.findIndex((x) => x.userId.toString() === userId) + 1;
}
