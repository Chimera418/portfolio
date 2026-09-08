import type { APIRoute } from 'astro';

// Server-rendered endpoint returning the user's most recent scrobbles.
export const prerender = false;

let cached: any = null;
let cacheExpiry = 0;
const CACHE_MS = 30000;

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
    if (Date.now() < cacheExpiry && cached) {
      return new Response(JSON.stringify({ tracks: cached }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
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
      `&user=${encodeURIComponent(user)}&api_key=${apiKey}&format=json&limit=10`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Last.fm API returned ${res.status}`);

    const data = await res.json();
    const rawTracks: any[] = data?.recenttracks?.track ?? [];

    const tracks = await Promise.all(
      rawTracks.slice(0, 10).map(async (raw) => {
        const artist = raw.artist?.['#text'] ?? raw.artist?.name ?? '';
        const images: any[] = Array.isArray(raw.image) ? raw.image : [];
        let image =
          [...images].reverse().find((img) => img['#text'])?.['#text'] || null;

        if (!image || image.includes(LASTFM_DEFAULT_ART)) {
          image = (await itunesArtwork(artist, raw.name)) || image;
        }

        const nowPlaying = raw['@attr']?.nowplaying === 'true';
        return {
          name: raw.name,
          artist,
          image,
          url: raw.url,
          nowPlaying,
          when: nowPlaying ? 'Scrobbling now' : raw.date?.['#text'] ?? '',
        };
      }),
    );

    cached = tracks;
    cacheExpiry = Date.now() + CACHE_MS;

    return new Response(JSON.stringify({ tracks }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error: any) {
    console.error('Last.fm recent error:', error);
    if (cached) {
      return new Response(JSON.stringify({ tracks: cached }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ tracks: [], error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
