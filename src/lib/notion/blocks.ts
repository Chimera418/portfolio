import { getNotionClient } from './client';
import { getBlocksCache, setBlocksCache } from './redis';

/**
 * Recursively fetches all blocks for a given page/block ID.
 * Caches the result with a strict 3-minute physical TTL (no stale-on-error).
 * This ensures signed S3 image URLs are never served stale.
 */
export async function getBlocks(blockId: string): Promise<any[]> {
  const cacheKey = `archive:blocks:${blockId}`;
  
  // Try strictly physical cache first
  const cached = await getBlocksCache<any[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const notion = getNotionClient();
    const blocks: any[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });

      blocks.push(...response.results);
      cursor = response.next_cursor || undefined;
    } while (cursor);

    // Fetch children for blocks that have them (e.g. nested lists, toggles)
    const blocksWithChildren = await Promise.all(
      blocks.map(async (block) => {
        if (block.has_children) {
          block.children = await getBlocks(block.id);
        }
        return block;
      })
    );

    // Cache the fully resolved block tree strictly for 3 minutes
    await setBlocksCache(cacheKey, blocksWithChildren);
    return blocksWithChildren;

  } catch (error) {
    console.error(`[Notion] Error fetching blocks for ${blockId}:`, error);
    // Since there is no stale-on-error for blocks, we just throw or return empty.
    // Returning empty array will essentially render an empty article on failure,
    // which is safe compared to serving expired image URLs.
    return [];
  }
}
