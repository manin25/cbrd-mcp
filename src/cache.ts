import { LRUCache } from 'lru-cache';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new LRUCache<string, any>({
  max: 500,
  // Default TTL: 5 minutes
  ttl: 5 * 60 * 1000,
});

const DETAIL_TTL = 15 * 60 * 1000; // 15 minutes for company details

function makeKey(tool: string, params: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(params)}`;
}

export function getCached<T>(tool: string, params: Record<string, unknown>): T | undefined {
  const key = makeKey(tool, params);
  return cache.get(key) as T | undefined;
}

export function setCache<T>(tool: string, params: Record<string, unknown>, value: T, isDetail = false): void {
  const key = makeKey(tool, params);
  cache.set(key, value, { ttl: isDetail ? DETAIL_TTL : undefined });
}
