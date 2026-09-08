import type { APIRoute } from 'astro';

export const prerender = false;

const LANYARD_USER_ID = '736465046317563915';
const LANYARD_API = `https://api.lanyard.rest/v1/users/${LANYARD_USER_ID}`;

/**
 * Names of apps that are NOT games.
 * Checked case-insensitively as prefix/substring matches.
 */
const NON_GAME_NAMES = new Set([
  'spotify',
  'discord',
  'visual studio code',
  'vscode',
  'cursor',
  'google chrome',
  'chrome',
  'firefox',
  'brave',
  'brave browser',
  'obsidian',
  'postman',
  'insomnia',
  'figma',
  'slack',
  'notion',
  'steam',             // Steam client itself
  'origin',
  'epic games',
  'battle.net',
  'ubisoft connect',
  'ea app',
  'windows explorer',
  'explorer',
  'task manager',
  'obs studio',
  'obs',
  'vlc',
  'winrar',
  '7-zip',
  'notepad',
  'powershell',
  'cmd',
  'terminal',
  'warp',
  'hyper',
  'iterm',
  'sublime text',
  'vim',
  'neovim',
  'emacs',
  'jetbrains',
  'intellij',
  'webstorm',
  'pycharm',
  'rider',
  'clion',
  'datagrip',
  'github desktop',
  'gitkraken',
  'sourcetree',
  'docker desktop',
  'linear',
  'jira',
  'zoom',
  'teams',
  'microsoft teams',
  'skype',
  'telegram',
  'whatsapp',
  'signal',
  'twitter',
  'x',
  'youtube',
  'twitch',
]);

function isNonGame(name: string): boolean {
  const lower = name.toLowerCase().trim();
  for (const blocked of NON_GAME_NAMES) {
    if (lower === blocked || lower.startsWith(blocked + ' ') || lower.includes(blocked)) {
      return true;
    }
  }
  return false;
}

function buildImageUrl(activity: any): string | null {
  const largeImage: string | undefined = activity.assets?.large_image;
  if (!largeImage) return null;

  if (largeImage.startsWith('mp:external/')) {
    return `https://media.discordapp.net/${largeImage.replace('mp:', '')}`;
  }
  if (largeImage.startsWith('https://')) return largeImage;

  const appId = activity.application_id;
  if (appId) {
    return `https://cdn.discordapp.com/app-assets/${appId}/${largeImage}.png`;
  }
  return null;
}

let cachedIgdbToken: string | null = null;
let tokenExpiresAt: number = 0;

interface CachedCover {
  igdbId: number;
  url: string;
  timestamp: number;
}
const coverCache = new Map<string, CachedCover>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

function normalizeGameName(name: string): string {
  return name
    .replace(/ \((.*?)\)$/, '') // remove parentheticals like " (Beta)"
    .replace(/ - (.*?)$/, '')   // remove suffix like " - Multiplayer"
    .trim();
}

async function getIgdbToken(clientId: string, clientSecret: string) {
  if (cachedIgdbToken && Date.now() < tokenExpiresAt) {
    return cachedIgdbToken;
  }
  try {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    cachedIgdbToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedIgdbToken;
  } catch (e) {
    console.error('Failed to get IGDB token', e);
    return null;
  }
}

async function getIgdbCover(gameName: string, clientId: string, token: string): Promise<string | null> {
  const normalized = normalizeGameName(gameName);
  


  if (coverCache.has(normalized)) {
    const cached = coverCache.get(normalized)!;
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.url;
    } else {
      coverCache.delete(normalized);
    }
  }

  const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slugQuery = `
    fields name, cover.url, cover.image_id;
    where slug = "${slug}";
    limit 1;
  `;
  try {
    let res = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`
      },
      body: slugQuery
    });
    
    let data = res.ok ? await res.json() : [];
    
    if (!data || data.length === 0) {
      const fallbackQuery = `
        search "${normalized.replace(/"/g, '\\"')}";
        fields name, cover.url, cover.image_id;
        limit 1;
      `;
      res = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${token}`
        },
        body: fallbackQuery
      });
      data = res.ok ? await res.json() : [];
    }
    
    const game = data[0];
    
    if (game?.cover?.image_id) {
      const url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`;
      coverCache.set(normalized, {
        igdbId: game.id,
        url,
        timestamp: Date.now()
      });
      return url;
    } else if (game?.cover?.url) {
      // Fallback url conversion as requested
      let url = game.cover.url;
      if (url.startsWith('//')) url = 'https:' + url;
      url = url.replace('t_thumb', 't_cover_big');
      coverCache.set(normalized, {
        igdbId: game.id,
        url,
        timestamp: Date.now()
      });
      return url;
    }
  } catch (e) {
    console.error('IGDB fetch error', e);
  }
  return null;
}

export const GET: APIRoute = async () => {
  try {
    const res = await fetch(LANYARD_API);
    if (!res.ok) throw new Error(`Lanyard returned ${res.status}`);

    const json = await res.json();
    if (!json.success || !json.data) throw new Error('Bad Lanyard response');

    const activities: any[] = json.data.activities ?? [];

    // 1. Prefer rich-presence games (type 0 + assets)
    // 2. Fall back to any type 0 that isn't blocked
    // 3. Ignore type 4 (custom status) and listening_to_spotify entirely
    const gameActivity =
      activities.find(
        (a) =>
          a.type === 0 &&
          a.name &&
          !isNonGame(a.name) &&
          !!a.assets
      ) ??
      activities.find(
        (a) => a.type === 0 && a.name && !isNonGame(a.name)
      );

    if (!gameActivity) {
      // Fetch from Upstash Redis if available
      const UPSTASH_URL = import.meta.env.UPSTASH_REDIS_REST_URL;
      const UPSTASH_TOKEN = import.meta.env.UPSTASH_REDIS_REST_TOKEN;
      let cachedGame = null;
      if (UPSTASH_URL && UPSTASH_TOKEN) {
        try {
          const upstashRes = await fetch(`${UPSTASH_URL}/get/last_played_game`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
          });
          const upstashJson = await upstashRes.json();
          if (upstashJson.result) {
            cachedGame = JSON.parse(upstashJson.result);
          }
        } catch (e) {
          console.error("Upstash fetch error:", e);
        }
      }

      return new Response(JSON.stringify({ game: null, cached: cachedGame }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, max-age=0'
        },
      });
    }

    const appId = gameActivity.application_id ?? null;
    let image: string | null = null;
    
    // 1. Try to fetch high-quality cover from IGDB
    const igdbClientId = import.meta.env.IGDB_CLIENT_ID;
    const igdbClientSecret = import.meta.env.IGDB_CLIENT_SECRET;
    
    if (igdbClientId && igdbClientSecret && igdbClientId !== 'your_client_id_here') {
      const token = await getIgdbToken(igdbClientId, igdbClientSecret);
      if (token) {
        image = await getIgdbCover(gameActivity.name, igdbClientId, token);
      }
    }

    // 2. Fallback to Discord rich presence asset
    if (!image) {
      image = buildImageUrl(gameActivity);
    }

    // 3. Fallback: if no rich presence assets, use the Discord app icon
    //serves Discord app icons reliably for game apps
    if (!image && appId) {
      image = `https://dcdn.dstn.to/app-icons/${appId}`;
    }

    const game = {
      name: gameActivity.name,
      details: gameActivity.details ?? null,
      state: gameActivity.state ?? null,
      image,
      large_text: gameActivity.assets?.large_text ?? null,
      // timestamps.start is Unix ms when the session began
      session_start: gameActivity.timestamps?.start ?? null,
      application_id: appId,
      last_seen: Date.now()
    };

    // Save to Upstash Redis globally
    const UPSTASH_URL = import.meta.env.UPSTASH_REDIS_REST_URL;
    const UPSTASH_TOKEN = import.meta.env.UPSTASH_REDIS_REST_TOKEN;
    if (UPSTASH_URL && UPSTASH_TOKEN) {
      const auth = { Authorization: `Bearer ${UPSTASH_TOKEN}` };

      fetch(`${UPSTASH_URL}/set/last_played_game`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(game)
      }).catch(() => {});

      // Maintain a rolling "recently played" list from Lanyard presence
      // (most-recent-first, de-duped by name, capped at 10). This is what the
      // games card's "recent" modal reads — no Steam Web API key required.
      (async () => {
        try {
          const r = await fetch(`${UPSTASH_URL}/get/recent_games`, { headers: auth });
          const j = await r.json();
          let list: any[] = [];
          try { if (j.result) list = JSON.parse(j.result); } catch {}
          if (!Array.isArray(list)) list = [];

          list = list.filter((x) => x && x.name !== game.name);
          list.unshift({
            name: game.name,
            image: game.image,
            application_id: game.application_id,
            last_seen: game.last_seen,
          });
          list = list.slice(0, 10);

          await fetch(`${UPSTASH_URL}/set/recent_games`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify(list),
          });
        } catch {}
      })();
    }

    return new Response(JSON.stringify({ game }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0'
      },
    });
  } catch (err: any) {
    console.error('Lanyard gaming error:', err);
    return new Response(
      JSON.stringify({ game: null, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
