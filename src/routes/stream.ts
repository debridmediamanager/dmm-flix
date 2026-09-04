import type { RowDataPacket } from "mysql2";
import { getPool, type ContentRow } from "../db";
import { resolveStreams } from "../embed-su";
import { config } from "../config";
import { corsJson } from "../utils/cors";
import { parseId } from "../utils/parse-id";

const TMDB_BASE = "https://api.themoviedb.org/3";

async function findTmdbId(
  imdbId: string,
  mediaType: "movie" | "tv"
): Promise<number | null> {
  if (!config.tmdbApiKey) return null;

  const url = `${TMDB_BASE}/find/${imdbId}?api_key=${config.tmdbApiKey}&external_source=imdb_id`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, any[]>;

    const key = mediaType === "movie" ? "movie_results" : "tv_results";
    const results = data[key];
    if (results && results.length > 0) {
      return results[0].id;
    }
    return null;
  } catch {
    return null;
  }
}

async function getTmdbIdFromDb(
  imdbId: string,
  mediaType: "movie" | "tv"
): Promise<number | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(ContentRow & RowDataPacket)[]>(
      "SELECT tmdb_id FROM content WHERE imdb_id = ? AND media_type = ? LIMIT 1",
      [imdbId, mediaType]
    );
    if (rows.length > 0) return rows[0].tmdb_id;
  } catch {
    // DB unavailable — fall through to TMDB API
  }
  return null;
}

export async function handleStream(
  mediaType: string,
  id: string
): Promise<Response> {
  const parsed = parseId(id);
  if (!parsed) {
    return corsJson({ streams: [] });
  }

  if (mediaType !== "movie" && mediaType !== "series") {
    return corsJson({ streams: [] });
  }

  if (mediaType === "series" && (parsed.season == null || parsed.episode == null)) {
    return corsJson({ streams: [] });
  }

  const dbMediaType = mediaType === "series" ? "tv" : "movie";

  // Try DB first, fall back to TMDB API
  let tmdbId = await getTmdbIdFromDb(parsed.imdbId, dbMediaType);
  if (tmdbId == null) {
    tmdbId = await findTmdbId(parsed.imdbId, dbMediaType);
  }

  if (tmdbId == null) {
    return corsJson({ streams: [] });
  }

  try {
    const resolved = await resolveStreams(
      tmdbId,
      dbMediaType,
      parsed.season ?? undefined,
      parsed.episode ?? undefined
    );

    const streams = resolved.map((s) => ({
      name: `DMM Flix`,
      title: s.name,
      url: s.url,
      behaviorHints: {
        bingeGroup: `dmm-flix-${s.name}`,
        proxyHeaders: {
          request: {
            Referer: "https://embed.su/",
            Origin: "https://embed.su",
          },
        },
      },
      ...(s.subtitles.length > 0 && {
        subtitles: s.subtitles.map((sub) => ({
          lang: sub.label,
          url: sub.file,
        })),
      }),
    }));

    return corsJson({ streams });
  } catch (err) {
    console.error(`Error resolving streams for TMDB ${tmdbId}:`, err);
    return corsJson({ streams: [] });
  }
}
