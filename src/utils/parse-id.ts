export interface ParsedId {
  imdbId: string;
  season?: number;
  episode?: number;
}

export function parseId(id: string): ParsedId | null {
  // Remove .json suffix if present
  const clean = id.replace(/\.json$/, "");

  // Format: tt1234567 (movie) or tt1234567:1:1 (series)
  const parts = clean.split(":");

  if (parts.length === 1) {
    const imdbId = parts[0];
    if (!imdbId.startsWith("tt")) return null;
    return { imdbId };
  }

  if (parts.length === 3) {
    const [imdbId, seasonStr, episodeStr] = parts;
    if (!imdbId.startsWith("tt")) return null;
    const season = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);
    if (isNaN(season) || isNaN(episode)) return null;
    return { imdbId, season, episode };
  }

  return null;
}
