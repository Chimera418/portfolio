import { Client } from '@notionhq/client';

let notion: Client | null = null;

try {
  if (import.meta.env.NOTION_API_TOKEN) {
    // @notionhq/client v5 defaults to notionVersion: '2025-09-03'
    // Do not override — let the SDK use its own default for the installed version.
    notion = new Client({
      auth: import.meta.env.NOTION_API_TOKEN,
    });
  }
} catch (e) {
  console.warn('[Notion] Failed to initialize:', e);
}

export function getNotionClient(): Client {
  if (!notion) {
    throw new Error('Notion client not initialized. Check NOTION_API_TOKEN in env.');
  }
  return notion;
}
