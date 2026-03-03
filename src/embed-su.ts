const EMBED_BASE = "https://embed.su";

export interface Server {
  name: string;
  hash: string;
}

export interface StreamSource {
  source: string;
  subtitles: { label: string; file: string }[];
  format: string;
}

function decodeHash(hash: string): Server[] {
  const step1 = atob(hash);
  const parts = step1.split(".");
  const reversed = parts.map((p) => p.split("").reverse().join(""));
  const joined = reversed.join("");
  const flipped = joined.split("").reverse().join("");
  const decoded = atob(flipped);
  return JSON.parse(decoded);
}

export async function getServers(
  tmdbId: number,
  mediaType: "movie" | "tv" = "movie",
  season?: number,
  episode?: number
): Promise<Server[]> {
  let path: string;
  if (mediaType === "tv" && season != null && episode != null) {
    path = `/embed/tv/${tmdbId}/${season}/${episode}`;
  } else {
    path = `/embed/movie/${tmdbId}`;
  }

  const res = await fetch(`${EMBED_BASE}${path}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: `${EMBED_BASE}/`,
    },
  });

  if (!res.ok) {
    throw new Error(`embed.su returned ${res.status} for ${path}`);
  }

  const html = await res.text();

  const match = html.match(
    /window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+)`\)\)/
  );
  if (!match) {
    throw new Error("Could not find vConfig in embed page");
  }

  const vConfig = JSON.parse(atob(match[1]));
  const hash: string = vConfig.hash;
  if (!hash) {
    throw new Error("No hash found in vConfig");
  }

  return decodeHash(hash);
}

export async function getStreamUrl(
  serverHash: string
): Promise<StreamSource | null> {
  const res = await fetch(`${EMBED_BASE}/api/e/${serverHash}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: `${EMBED_BASE}/`,
    },
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

export async function resolveStreams(
  tmdbId: number,
  mediaType: "movie" | "tv" = "movie",
  season?: number,
  episode?: number
): Promise<{ name: string; url: string; subtitles: { label: string; file: string }[] }[]> {
  const servers = await getServers(tmdbId, mediaType, season, episode);
  const results: { name: string; url: string; subtitles: { label: string; file: string }[] }[] = [];

  const settled = await Promise.allSettled(
    servers.map(async (server) => {
      const stream = await getStreamUrl(server.hash);
      if (stream?.source) {
        return {
          name: server.name,
          url: stream.source,
          subtitles: stream.subtitles || [],
        };
      }
      return null;
    })
  );

  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      results.push(result.value);
    }
  }

  return results;
}
