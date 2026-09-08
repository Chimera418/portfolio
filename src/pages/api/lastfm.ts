import type { APIRoute } from 'astro';

// This endpoint must be rendered on the server
export const prerender = false;

// In-memory cache to avoid hammering the Last.fm API on every poll
let cachedData: any = null;
let cacheExpiry = 0;
const CACHE_MS = 20000;

// Last.fm serves this image hash as a generic "star" placeholder when a track has no art.
const LASTFM_DEFAULT_ART = '2a96cbd8b46e442fc41c2b86b821562f';

/** Fall back to iTunes cover art when Last.fm has no real image for a track. */
async function itunesArtwork(artist: string, track: string): Promise<string | null> {
  try {
    const term = `${artist} ${track}`.trim();
    if (!term) return null;
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const art: string | undefined = data?.results?.[0]?.artworkUrl100;
    return art ? art.replace('100x100bb', '600x600bb').replace('100x100', '600x600') : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async () => {
  try {
    // Serve from memory cache if valid
    if (Date.now() < cacheExpiry && cachedData) {
      return new Response(JSON.stringify({ track: cachedData }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30',
        },
      });
    }

    const apiKey = import.meta.env.LASTFM_API_KEY;
    const user = import.meta.env.LASTFM_USER;

    if (!apiKey || !user) {
      throw new Error('Missing Last.fm credentials in environment variables.');
    }

    const url =
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
      `&user=${encodeURIComponent(user)}&api_key=${apiKey}&format=json&limit=1`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Last.fm API returned ${res.status}`);
    }

    const data = await res.json();
    const raw = data?.recenttracks?.track?.[0];

    let track = null;
    if (raw) {
      const artist = raw.artist?.['#text'] ?? raw.artist?.name ?? '';
      // Last.fm returns images small→extralarge; grab the largest non-empty one.
      const images: any[] = Array.isArray(raw.image) ? raw.image : [];
      let image =
        [...images].reverse().find((img) => img['#text'])?.['#text'] || null;

      if (!image || image.includes(LASTFM_DEFAULT_ART)) {
        image = (await itunesArtwork(artist, raw.name)) || image;
      }

      const nowPlaying = raw['@attr']?.nowplaying === 'true';

      track = {
        name: raw.name,
        artist,
        album: raw.album?.['#text'] ?? '',
        image,
        url: raw.url,
        nowPlaying,
        playedAt: raw.date?.uts ? Number(raw.date.uts) * 1000 : null,
      };
    }

    // Update cache (fall back to previous cache if the fetch came back empty)
    if (track) {
      cachedData = track;
      cacheExpiry = Date.now() + CACHE_MS;
    } else if (cachedData) {
      track = cachedData;
      cacheExpiry = Date.now() + CACHE_MS;
    }

    return new Response(JSON.stringify({ track }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30',
      },
    });
  } catch (error: any) {
    console.error('Last.fm API error:', error);

    // Serve stale cache on error if we have it
    if (cachedData) {
      return new Response(JSON.stringify({ track: cachedData }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30',
        },
      });
    }

    return new Response(JSON.stringify({ track: null, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
