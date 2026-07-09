# Notion Archive Setup Guide

The Archive system has been implemented! Before it can display content on your website, you need to set up a Notion database and connect it to your project.

## 1. Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Name it "Chimera Realm Archive"
4. Make sure it has "Read content" capabilities.
5. Copy the **Internal Integration Secret**. 
   - Add this to your `.env` file as `NOTION_API_TOKEN`.

## 2. Create the Database

1. In Notion, create a new full-page Database.
2. Name it something like "Website Archive".
3. Click the `...` menu in the top right of the Notion page, go to **Add connections**, and select your "Chimera Realm Archive" integration to give it access.

## 3. Configure Database Properties

Your database **must** have the following properties with these exact names and types:

| Property Name | Property Type | Description |
|---|---|---|
| **Title** (or **Name**) | Title | The title of the post |
| **Slug** | Text | URL-friendly identifier (e.g. `gpn-ctf-2026`) |
| **Type** | Select | Must be one of: `Devlog`, `Blog`, `Writeup`, `Note` |
| **Published** | Checkbox | Check this to make the post live on the site |
| **Date** | Date | The publish date (will default to today if empty) |
| **Description** | Text | Short summary for the list card |
| **Tags** | Multi-select | E.g., `astro`, `ctf`, `security` |
| **Image** | Files & media | Cover image for the card and post header (optional) |
| **Link** | URL | External site link (optional) |
| **GitHub** | URL | Source code link (optional) |

## 4. Get the Data Source ID

Since this uses the latest Notion API, you need the **Data Source ID** (which is essentially the Database ID):
1. Open your database in Notion as a full page.
2. Click the `...` menu in the top right and select **Copy link**.
3. The URL will look like: `https://www.notion.so/workspace/1234567890abcdef1234567890abcdef?v=...`
4. The long string (`1234567890abcdef1234567890abcdef`) is your ID.
5. Add this to your `.env` file as **`NOTION_DATA_SOURCE_ID`**. (You can also set `NOTION_DATABASE_ID` to the same value).

## 5. Test It Out

1. Create a new row in your Notion database.
2. Fill out the properties (e.g., set Slug to `hello-world`, Type to `Devlog`, check Published).
3. Add some blocks inside the page (text, images, code blocks).
4. Run your local dev server: `npm run dev`
5. Navigate to `http://localhost:4321/archive` and you should see your entry!

_Note: S3 Image URLs are fetched directly and expire after 1 hour, but the server automatically refreshes them in the background via a 3-minute Redis cache TTL. There's no need to manually rebuild the site when publishing content!_
