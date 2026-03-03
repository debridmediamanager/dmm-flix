import type { RowDataPacket } from "mysql2";
import { getPool, type ContentRow } from "../db";
import { resolveStreams } from "../embed-su";
import { corsJson } from "../utils/cors";
import { parseId } from "../utils/parse-id";

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

  const pool = getPool();
  const dbMediaType = mediaType === "series" ? "tv" : "movie";

  const [rows] = await pool.query<(ContentRow & RowDataPacket)[]>(
    "SELECT tmdb_id, title FROM content WHERE imdb_id = ? AND media_type = ? LIMIT 1",
    [parsed.imdbId, dbMediaType]
  );

  if (rows.length === 0) {
    return corsJson({ streams: [] });
  }

  const { tmdb_id: tmdbId } = rows[0];

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
