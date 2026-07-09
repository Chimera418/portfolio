import type { ArchiveListItem, ArchiveType } from './types';

function extractText(property: any): string {
  if (!property) return '';
  if (property.type === 'title') {
    return property.title?.map((t: any) => t.plain_text).join('') || '';
  }
  if (property.type === 'rich_text') {
    return property.rich_text?.map((t: any) => t.plain_text).join('') || '';
  }
  return '';
}

function extractDate(property: any): string {
  if (property?.type === 'date' && property.date?.start) {
    return property.date.start;
  }
  return new Date().toISOString();
}

function extractTags(property: any): string[] {
  if (property?.type === 'multi_select') {
    return property.multi_select?.map((s: any) => s.name) || [];
  }
  return [];
}

function extractSelect(property: any): string {
  if (property?.type === 'select') {
    return property.select?.name || '';
  }
  return '';
}

function extractUrl(property: any): string | undefined {
  if (property?.type === 'url') {
    return property.url || undefined;
  }
  return undefined;
}

export function normalizeEntry(page: any): ArchiveListItem {
  const props = page.properties;

  // We map the common properties
  const title = extractText(props.Title || props.Name);
  const slug = extractText(props.Slug);
  const description = extractText(props.Description);
  const date = extractDate(props.Date);
  const tags = extractTags(props.Tags);
  const type = extractSelect(props.Type).toLowerCase() as ArchiveType;
  const link = extractUrl(props.Link);

  // 'Github' (lowercase h) is a files property in this database, not a url property
  let github = undefined;
  const githubProp = props.Github || props.GitHub;
  if (githubProp?.type === 'url') {
    github = githubProp.url || undefined;
  } else if (githubProp?.type === 'files' && githubProp.files?.length > 0) {
    const f = githubProp.files[0];
    github = f.type === 'external' ? f.external.url : f.file?.url;
  }
  
  let image = undefined;
  if (props.Image?.type === 'files' && props.Image.files?.length > 0) {
    const file = props.Image.files[0];
    image = file.type === 'external' ? file.external.url : file.file.url;
  } else if (page.cover) {
    image = page.cover.type === 'external' ? page.cover.external.url : page.cover.file.url;
  }

  return {
    id: page.id,
    title,
    slug,
    type,
    description,
    tags,
    date,
    image,
    link,
    github
  };
}
