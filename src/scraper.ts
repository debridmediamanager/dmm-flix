import { config } from "./config";
import { getPool, ensureContentTable } from "./db";

const CINEBY_BASE = "https://cineby.gd";
const TMDB_BASE = "https://api.themoviedb.org/3";

interface CinebyItem {
  id: number; // TMDB ID
  title?: string;
  name?: string;
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
}

interface NextDataPayload {
  props?: {
    pageProps?: {
      genreSections?: { results: CinebyItem[] }[];
      trendingSections?: { results: CinebyItem[] }[];
      trending?: { results: CinebyItem[] };
      movies?: CinebyItem[];
      tvShows?: CinebyItem[];
      results?: CinebyItem[];
      [key: string]: unknown;
    };
  };
}

async function fetchNextData(path: string): Promise<CinebyItem[]> {
  const url = `${CINEBY_BASE}${path}`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch ${url}: ${res.status}`);
    return [];
  }

  const html = await res.text();
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!match) {
    console.error(`No __NEXT_DATA__ found on ${url}`);
    return [];
  }

  let data: NextDataPayload;
  try {
    data = JSON.parse(match[1]);
  } catch {
    console.error(`Failed to parse __NEXT_DATA__ on ${url}`);
    return [];
  }

  const items: CinebyItem[] = [];
  const pageProps = data.props?.pageProps;
  if (!pageProps) return items;

  // Extract items from all possible data structures
  for (const value of Object.values(pageProps)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "id" in item) {
          items.push(item as CinebyItem);
        }
        // Sections with nested results
        if (
          item &&
          typeof item === "object" &&
          "results" in item &&
          Array.isArray((item as { results: unknown }).results)
        ) {
          items.push(...(item as { results: CinebyItem[] }).results);
        }
      }
    }
    if (
      value &&
      typeof value === "object" &&
      "results" in value &&
      Array.isArray((value as { results: unknown }).results)
    ) {
      items.push(...(value as { results: CinebyItem[] }).results);
    }
  }

  return items;
}

async function resolveImdbId(
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<string | null> {
  if (!config.tmdbApiKey) return null;

  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids?api_key=${config.tmdbApiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { imdb_id?: string };
    return data.imdb_id || null;
  } catch {
    return null;
  }
}

function extractYear(item: CinebyItem): string | null {
  const date = item.release_date || item.first_air_date;
  if (!date) return null;
  return date.substring(0, 4);
}

function inferMediaType(
  item: CinebyItem,
  pageHint?: "movie" | "tv"
): "movie" | "tv" {
  if (item.media_type === "tv" || item.media_type === "movie") {
    return item.media_type;
  }
  if (pageHint) return pageHint;
  // If it has 'name' instead of 'title', it's likely TV
  if (item.name && !item.title) return "tv";
  return "movie";
}

async function main() {
  if (!config.tmdbApiKey) {
    console.warn(
      "WARNING: TMDB_API_KEY not set. IMDB IDs will not be resolved."
    );
  }

  await ensureContentTable();
  const pool = getPool();

  // Pages to crawl
  const pages: { path: string; hint?: "movie" | "tv" }[] = [
    { path: "/" },
    { path: "/movies", hint: "movie" },
    { path: "/tv-shows", hint: "tv" },
  ];

  // Deduplicate by tmdb_id + media_type
  const seen = new Map<string, CinebyItem & { _mediaType: "movie" | "tv" }>();

  for (const page of pages) {
    const items = await fetchNextData(page.path);
    for (const item of items) {
      if (!item.id) continue;
      const mediaType = inferMediaType(item, page.hint);
      const key = `${item.id}:${mediaType}`;
      if (!seen.has(key)) {
        seen.set(key, { ...item, _mediaType: mediaType });
      }
    }
  }

  console.log(`Discovered ${seen.size} unique items`);

  let movieCount = 0;
  let tvCount = 0;
  let errorCount = 0;

  const entries = Array.from(seen.values());

  // Process in batches to avoid rate limiting TMDB API
  const BATCH_SIZE = 20;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (item) => {
        try {
          const title = item.title || item.name || "Unknown";
          const mediaType = item._mediaType;
          const poster = item.poster_path
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : null;
          const year = extractYear(item);

          const imdbId = await resolveImdbId(item.id, mediaType);

          await pool.query(
            `INSERT INTO content (imdb_id, tmdb_id, title, media_type, poster, year, source)
             VALUES (?, ?, ?, ?, ?, ?, 'cineby')
             ON DUPLICATE KEY UPDATE
               imdb_id = COALESCE(VALUES(imdb_id), imdb_id),
               title = VALUES(title),
               poster = VALUES(poster),
               year = VALUES(year)`,
            [imdbId, item.id, title, mediaType, poster, year]
          );

          if (mediaType === "movie") movieCount++;
          else tvCount++;
        } catch (err) {
          errorCount++;
          console.error(`Error processing item ${item.id}:`, err);
        }
      })
    );

    if (i + BATCH_SIZE < entries.length) {
      // Small delay between batches
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  console.log(
    `Done! Inserted/updated: ${movieCount} movies, ${tvCount} TV shows. Errors: ${errorCount}`
  );

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Scraper failed:", err);
  process.exit(1);
});
