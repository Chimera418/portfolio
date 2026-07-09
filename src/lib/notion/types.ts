export type ArchiveType = 'devlogs' | 'blogs' | 'writeups' | 'notes';

export interface ArchiveListItem {
  id: string;
  title: string;
  slug: string;
  type: ArchiveType;
  description: string;
  tags: string[];
  date: string;
  image?: string;
  link?: string;
  github?: string;
}

export interface ArchiveEntry extends ArchiveListItem {
  contentBlocks: any[]; // We will type this properly if needed, or leave as any[] for simplicity
}

export interface CachePayload<T> {
  data: T;
  timestamp: number; // For logical freshness check
}
