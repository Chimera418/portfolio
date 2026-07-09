import { Redis } from '@upstash/redis';
import type { CachePayload } from './types';

let redis: Redis | null = null;
try {
  if (import.meta.env.UPSTASH_REDIS_REST_URL && import.meta.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: import.meta.env.UPSTASH_REDIS_REST_URL,
      token: import.meta.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (e) {
  console.warn('[Redis] Failed to initialize:', e);
}

const FRESHNESS_MS = 3 * 60 * 1000; // 3 minutes
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days physical TTL for metadata
const BLOCKS_TTL_SECONDS = 3 * 60; // 3 minutes physical TTL for blocks

/**
 * Metadata cache (Listings and Entry Metadata).
 * Uses stale-on-error semantics with a logical freshness timestamp.
 */
export async function getMetadataCache<T>(key: string): Promise<{ data: T; isStale: boolean } | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get<CachePayload<T>>(key);
    if (!cached) return null;
    const isStale = Date.now() - cached.timestamp > FRESHNESS_MS;
    return { data: cached.data, isStale };
  } catch (e) {
    console.error(`[Redis] Error getting metadata cache for ${key}:`, e);
    return null;
  }
}

export async function setMetadataCache<T>(key: string, data: T): Promise<void> {
  if (!redis) return;
  try {
    const payload: CachePayload<T> = {
      data,
      timestamp: Date.now()
    };
    await redis.set(key, payload, { ex: STALE_TTL_SECONDS });
  } catch (e) {
    console.error(`[Redis] Error setting metadata cache for ${key}:`, e);
  }
}

/**
 * Blocks cache.
 * STRICT 3-minute physical TTL. No stale-on-error, as it contains temporary S3 signed URLs valid for 1 hour.
 */
export async function getBlocksCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    return await redis.get<T>(key);
  } catch (e) {
    console.error(`[Redis] Error getting blocks cache for ${key}:`, e);
    return null;
  }
}

export async function setBlocksCache<T>(key: string, data: T): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, data, { ex: BLOCKS_TTL_SECONDS });
  } catch (e) {
    console.error(`[Redis] Error setting blocks cache for ${key}:`, e);
  }
}
