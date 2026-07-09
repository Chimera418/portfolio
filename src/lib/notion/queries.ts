import { getNotionClient } from './client';
import { getMetadataCache, setMetadataCache } from './redis';
import { normalizeEntry } from './normalize';
import type { ArchiveListItem, ArchiveType } from './types';

const ALL_TYPES: ArchiveType[] = ['devlogs', 'blogs', 'writeups', 'notes'];

function capitalize(type: string): string {
  if (!type) return '';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Resolves the actual data source ID from the database ID if needed.
 * Notion v5 APIs use data_sources for queries, which have a different ID.
 */
export async function resolveDataSourceId(databaseId: string): Promise<string> {
  const cacheKey = `archive:datasource:${databaseId}`;
  const cached = await getMetadataCache<string>(cacheKey);
  
  if (cached && !cached.isStale) {
    return cached.data;
  }
  
  const notion = getNotionClient();
  try {
    const db = await (notion.databases as any).retrieve({ database_id: databaseId });
    let dataSourceId = databaseId;
    if (db.data_sources && db.data_sources.length > 0) {
      dataSourceId = db.data_sources[0].id;
    }
    
    // Cache for a long time (data source IDs don't change for a database)
    await setMetadataCache(cacheKey, dataSourceId);
    return dataSourceId;
  } catch (error) {
    console.error(`[Notion] Failed to resolve data source for db ${databaseId}:`, error);
    if (cached) return cached.data;
    throw error;
  }
}

/**
 * Fetches all published entries of a specific type (e.g. 'devlogs', 'blogs').
 * Uses @notionhq/client v2 databases.query with the standard database ID.
 * Never caches a failed/errored response as an empty array.
 */
export async function getArchiveEntries(type: ArchiveType): Promise<ArchiveListItem[]> {
  const cacheKey = `archive:list:${type}`;
  const cached = await getMetadataCache<ArchiveListItem[]>(cacheKey);

  // Return fresh cache immediately
  if (cached && !cached.isStale) {
    return cached.data;
  }

  try {
    const notion = getNotionClient();
    const databaseId = import.meta.env.NOTION_DATABASE_ID || import.meta.env.NOTION_DATA_SOURCE_ID;

    if (!databaseId) {
      throw new Error('Neither NOTION_DATABASE_ID nor NOTION_DATA_SOURCE_ID is defined in environment.');
    }
    
    // Resolve the actual data source ID
    const resolvedDataSourceId = await resolveDataSourceId(databaseId);

    // 'blogs' → 'Blog', 'writeups' → 'Writeup', etc.
    const singularType = type.endsWith('s') ? type.slice(0, -1) : type;
    const typeFilterName = capitalize(singularType);

    const response = await (notion.dataSources as any).query({
      data_source_id: resolvedDataSourceId,
      filter: {
        and: [
          {
            property: 'Published',
            checkbox: { equals: true }
          },
          {
            property: 'Type',
            select: { equals: typeFilterName }
          }
        ]
      },
      sorts: [
        {
          property: 'Date',
          direction: 'descending'
        }
      ]
    });

    const entries = response.results.map(normalizeEntry);

    // Only cache a successful (possibly empty) response
    await setMetadataCache(cacheKey, entries);
    return entries;

  } catch (error) {
    console.error(`[Notion] Error fetching archive entries for ${type}:`, error);

    // Fall back to stale cache — but do NOT cache the error itself
    if (cached) {
      console.warn(`[Notion] Falling back to stale cache for ${type} list.`);
      return cached.data;
    }
    // Return empty without caching — next request will retry the API
    return [];
  }
}

/**
 * Fetches a single published entry by type and slug.
 */
export async function getArchiveEntryBySlug(type: ArchiveType, slug: string): Promise<ArchiveListItem | null> {
  const cacheKey = `archive:entry:${type}:${slug}`;
  const cached = await getMetadataCache<ArchiveListItem>(cacheKey);

  if (cached && !cached.isStale) {
    return cached.data;
  }

  try {
    const notion = getNotionClient();
    const databaseId = import.meta.env.NOTION_DATABASE_ID || import.meta.env.NOTION_DATA_SOURCE_ID;

    if (!databaseId) {
      throw new Error('Neither NOTION_DATABASE_ID nor NOTION_DATA_SOURCE_ID is defined in environment.');
    }
    
    const resolvedDataSourceId = await resolveDataSourceId(databaseId);

    const singularType = type.endsWith('s') ? type.slice(0, -1) : type;
    const typeFilterName = capitalize(singularType);

    const response = await (notion.dataSources as any).query({
      data_source_id: resolvedDataSourceId,
      filter: {
        and: [
          {
            property: 'Published',
            checkbox: { equals: true }
          },
          {
            property: 'Type',
            select: { equals: typeFilterName }
          },
          {
            property: 'Slug',
            rich_text: { equals: slug }
          }
        ]
      }
    });

    if (response.results.length === 0) {
      return null;
    }

    if (response.results.length > 1) {
      console.error(`DuplicateSlugError: Found ${response.results.length} published entries for slug '${slug}' in type '${typeFilterName}'. Failing safely.`);
      return null;
    }

    const entry = normalizeEntry(response.results[0]);
    await setMetadataCache(cacheKey, entry);
    return entry;

  } catch (error) {
    console.error(`[Notion] Error fetching archive entry ${slug}:`, error);

    if (cached) {
      console.warn(`[Notion] Falling back to stale cache for entry ${slug}.`);
      return cached.data;
    }
    return null;
  }
}

/**
 * Returns which ArchiveTypes have at least one published entry.
 * Used to dynamically show/hide categories on the archive index page.
 */
export async function getPublishedTypes(): Promise<ArchiveType[]> {
  const cacheKey = 'archive:published-types';
  const cached = await getMetadataCache<ArchiveType[]>(cacheKey);

  if (cached && !cached.isStale) {
    return cached.data;
  }

  const results = await Promise.all(
    ALL_TYPES.map(async (type) => {
      const entries = await getArchiveEntries(type);
      return entries.length > 0 ? type : null;
    })
  );

  const publishedTypes = results.filter((t): t is ArchiveType => t !== null);

  // Only cache if we actually got results (even empty is fine here — it means no posts)
  await setMetadataCache(cacheKey, publishedTypes);
  return publishedTypes;
}
