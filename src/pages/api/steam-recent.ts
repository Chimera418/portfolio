import type { APIRoute } from 'astro';

// Returns recently-played games derived from Lanyard (Discord) presence, which
// `/api/steam` accumulates into Upstash Redis over time. No Steam Web API key needed.
export const prerender = false;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
}

export const GET: APIRoute = async () => {
  const UPSTASH_URL = import.meta.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = import.meta.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      return json({ games: [], error: 'Missing Upstash config' });
    }
    const auth = { Authorization: `Bearer ${UPSTASH_TOKEN}` };

    let list: any[] = [];
    const r = await fetch(`${UPSTASH_URL}/get/recent_games`, { headers: auth });
    const j = await r.json();
    try { if (j.result) list = JSON.parse(j.result); } catch {}
    if (!Array.isArray(list)) list = [];

    // Fallback: if no rolling list yet, use the single last-played game.
    if (list.length === 0) {
      const r2 = await fetch(`${UPSTASH_URL}/get/last_played_game`, { headers: auth });
      const j2 = await r2.json();
      try {
        if (j2.result) {
          const g = JSON.parse(j2.result);
          if (g && g.name) list = [g];
        }
      } catch {}
    }

    const games = list.slice(0, 10).map((g) => ({
      name: g.name,
      image: g.image ?? null,
      url: `https://store.steampowered.com/search/?term=${encodeURIComponent(g.name)}`,
      lastSeen: g.last_seen ?? null,
    }));

    return json({ games });
  } catch (error: any) {
    console.error('Steam recent (lanyard) error:', error);
    return json({ games: [], error: error.message });
  }
};
