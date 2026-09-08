# 🎵 Last.fm API Integration Guide

This project includes a live "Now Playing" card that fetches your current or most recent scrobble from the Last.fm API. Last.fm is much simpler to set up than Spotify — there's **no OAuth flow**, just a single API key and your username.

## Architecture

The integration works in two parts:
1. **Serverless Endpoint (`src/pages/api/lastfm.ts`)** — an Astro server API route that calls Last.fm's `user.getrecenttracks` method and caches the result in memory to avoid rate limits.
2. **Frontend Component (`src/components/LastFmCard.astro`)** — a UI component that polls the local endpoint every 30 seconds and shows album art, track, artist, and a **Now Playing** / **Last Played** status.

> **Note:** Last.fm shows what you *scrobble*, not what's literally playing right now on a device. You scrobble by connecting Last.fm to Spotify, Apple Music, YouTube Music, etc. — see their [music tracking guide](https://www.last.fm/about/trackmymusic). If nothing is scrobbling, the card falls back to your last played track.

---

## 🔐 Environment Variables

The project needs **two** variables. Your `.env` file is already in `.gitignore` — never commit it.

Add these to the `.env` file in the project root:

```env
LASTFM_API_KEY=your_lastfm_api_key_here
LASTFM_USER=your_lastfm_username
```

- `LASTFM_API_KEY` — the key you create below.
- `LASTFM_USER` — your Last.fm **username** (the one in your profile URL: `last.fm/user/THIS_PART`), *not* your email.

Only the **API key** is needed here. `user.getrecenttracks` is a public read method, so you can ignore the "shared secret" Last.fm also gives you (that's only for write/auth methods).

---

## 🛠️ How to Create Your API Key

### Step 1: Have a Last.fm account
If you don't already scrobble, [create a Last.fm account](https://www.last.fm/join) and connect it to a music service so it has something to show. Note your **username**.

### Step 2: Create an API account
1. Log in, then go to the **[Create API account](https://www.last.fm/api/account/create)** page.
2. Fill in the form:
   - **Contact email** — your email.
   - **Application name** — e.g. `Portfolio`.
   - **Application description** — a short line, e.g. "Now-playing card on my personal site."
   - **Callback URL** — leave blank (not needed for read-only calls).
   - **Application homepage** — optional (e.g. `https://chimera-realm.foo`).
3. Submit the form.

### Step 3: Copy your API key
After submitting, you'll see an **API Key** and a **Shared Secret**.
- Copy the **API Key** into `LASTFM_API_KEY` in your `.env`.
- You can ignore the Shared Secret for this project.

> 💡 You can view/manage your keys anytime at **[last.fm/api/accounts](https://www.last.fm/api/accounts)**.

### Step 4: Add your username and restart
Set `LASTFM_USER` to your username, then restart the dev server so Astro reloads `.env`:

```bash
npm run dev
```

Open the home page — the "Now Playing" card should populate within ~30 seconds.

---

## ✅ Quick Test

You can verify your key and username directly in a browser (replace both values):

```text
https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=YOUR_USERNAME&api_key=YOUR_API_KEY&format=json&limit=1
```

A valid setup returns JSON with a `recenttracks.track` array. If you get an `error` object instead:
- **error 6** → invalid/unknown username (check `LASTFM_USER`).
- **error 10** → invalid API key (check `LASTFM_API_KEY`).

---

## 🚀 Deployment (Production)

When you deploy to **Vercel**:
1. Open your project's **Settings → Environment Variables**.
2. Add `LASTFM_API_KEY` and `LASTFM_USER`.
3. Redeploy — the serverless function reads these values in production.

---

## 🔄 Switching Accounts

To point the card at a different Last.fm account, just update `LASTFM_USER` (and, if it's a different person's API registration, `LASTFM_API_KEY`) in `.env` and redeploy. No re-authorization needed.
