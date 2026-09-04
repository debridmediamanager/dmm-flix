import { describe, it, expect, afterEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock control: change these before each test to control DB responses
// ---------------------------------------------------------------------------
let mockQueryResult: any[] = [[], []];

let mockDbShouldThrow = false;

mock.module("../db", () => ({
  getPool: () => ({
    query: async (..._args: any[]) => {
      if (mockDbShouldThrow) throw new Error("DB unavailable");
      return mockQueryResult;
    },
  }),
  ensureContentTable: async () => {},
}));

mock.module("../config", () => ({
  config: {
    port: 7001,
    tmdbApiKey: "test-tmdb-key",
    db: { host: "localhost", port: 3306, user: "root", password: "", database: "test" },
  },
}));

// ---------------------------------------------------------------------------
// Imports (resolved after mock.module is hoisted by Bun)
// ---------------------------------------------------------------------------
import { getServers, getStreamUrl, resolveStreams } from "../embed-su";
import { handleStream } from "../routes/stream";
import { parseId } from "../utils/parse-id";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockQueryResult = [[], []];
  mockDbShouldThrow = false;
});

/**
 * Encode a Server[] array into the hash format that embed.su uses.
 * This is the inverse of decodeHash() in embed-su.ts.
 */
function encodeServersToHash(
  servers: { name: string; hash: string }[]
): string {
  const json = JSON.stringify(servers);
  const inner = btoa(json);
  const flipped = inner.split("").reverse().join("");
  const dotted = flipped.split("").join(".");
  return btoa(dotted);
}

/**
 * Build a fake embed.su HTML page containing vConfig with encoded servers.
 */
function makeEmbedHtml(
  servers: { name: string; hash: string }[]
): string {
  const hash = encodeServersToHash(servers);
  const vConfig = JSON.stringify({ hash });
  const vConfigB64 = btoa(vConfig);
  return `<html><script>window.vConfig = JSON.parse(atob(\`${vConfigB64}\`))</script></html>`;
}

const TEST_SERVERS = [
  { name: "Server Alpha", hash: "alphahash123" },
  { name: "Server Beta", hash: "betahash456" },
];

const STREAM_RESPONSE = {
  source: "https://cdn.example.com/movie.m3u8",
  subtitles: [{ label: "English", file: "https://cdn.example.com/en.vtt" }],
  format: "hls",
};

// ===========================================================================
// parseId
// ===========================================================================
describe("parseId", () => {
  it("parses a movie IMDB ID", () => {
    expect(parseId("tt0137523")).toEqual({ imdbId: "tt0137523" });
  });

  it("strips .json suffix", () => {
    expect(parseId("tt0137523.json")).toEqual({ imdbId: "tt0137523" });
  });

  it("parses a series ID with season and episode", () => {
    expect(parseId("tt0903747:2:3")).toEqual({
      imdbId: "tt0903747",
      season: 2,
      episode: 3,
    });
  });

  it("returns null for non-tt prefixed IDs", () => {
    expect(parseId("nm0000001")).toBeNull();
  });

  it("returns null for malformed series IDs", () => {
    expect(parseId("tt0903747:abc:1")).toBeNull();
    expect(parseId("tt0903747:1")).toBeNull();
  });
});

// ===========================================================================
// embed-su: getServers
// ===========================================================================
describe("getServers", () => {
  it("parses embed page HTML and returns decoded servers", async () => {
    const html = makeEmbedHtml(TEST_SERVERS);
    globalThis.fetch = (async () =>
      new Response(html, { status: 200 })) as typeof fetch;

    const servers = await getServers(550);
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({
      name: "Server Alpha",
      hash: "alphahash123",
    });
    expect(servers[1]).toEqual({
      name: "Server Beta",
      hash: "betahash456",
    });
  });

  it("uses the TV embed path for TV content", async () => {
    const html = makeEmbedHtml(TEST_SERVERS);
    const calls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      return new Response(html, { status: 200 });
    }) as typeof fetch;

    await getServers(1396, "tv", 1, 1);
    expect(calls[0]).toContain("/embed/tv/1396/1/1");
  });

  it("throws on non-200 response", async () => {
    globalThis.fetch = (async () =>
      new Response("Not Found", { status: 404 })) as typeof fetch;

    await expect(getServers(99999)).rejects.toThrow("embed.su returned 404");
  });
});

// ===========================================================================
// embed-su: getStreamUrl
// ===========================================================================
describe("getStreamUrl", () => {
  it("returns stream source data", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(STREAM_RESPONSE), {
        status: 200,
      })) as typeof fetch;

    const result = await getStreamUrl("testhash");
    expect(result).toEqual(STREAM_RESPONSE);
  });

  it("returns null on error response", async () => {
    globalThis.fetch = (async () =>
      new Response("Error", { status: 500 })) as typeof fetch;

    const result = await getStreamUrl("badhash");
    expect(result).toBeNull();
  });
});

// ===========================================================================
// embed-su: resolveStreams
// ===========================================================================
describe("resolveStreams", () => {
  it("resolves all servers to stream URLs", async () => {
    const embedHtml = makeEmbedHtml(TEST_SERVERS);

    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("/api/e/")) {
        return new Response(JSON.stringify(STREAM_RESPONSE));
      }
      return new Response(embedHtml, { status: 200 });
    }) as typeof fetch;

    const streams = await resolveStreams(550);
    expect(streams).toHaveLength(2);
    expect(streams[0].name).toBe("Server Alpha");
    expect(streams[0].url).toBe(STREAM_RESPONSE.source);
    expect(streams[1].name).toBe("Server Beta");
  });

  it("skips servers that fail to resolve", async () => {
    const embedHtml = makeEmbedHtml(TEST_SERVERS);
    let apiCallCount = 0;

    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("/api/e/")) {
        apiCallCount++;
        // First server succeeds, second fails
        if (apiCallCount === 1) {
          return new Response(JSON.stringify(STREAM_RESPONSE));
        }
        return new Response("Error", { status: 500 });
      }
      return new Response(embedHtml, { status: 200 });
    }) as typeof fetch;

    const streams = await resolveStreams(550);
    expect(streams).toHaveLength(1);
    expect(streams[0].name).toBe("Server Alpha");
  });
});

// ===========================================================================
// handleStream — end-to-end integration
// ===========================================================================
describe("handleStream", () => {
  it("returns streams for a known movie", async () => {
    // DB returns a content row for Fight Club
    mockQueryResult = [[{ tmdb_id: 550, title: "Fight Club" }], []];

    const embedHtml = makeEmbedHtml(TEST_SERVERS);
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("/api/e/")) {
        return new Response(JSON.stringify(STREAM_RESPONSE));
      }
      return new Response(embedHtml, { status: 200 });
    }) as typeof fetch;

    const response = await handleStream("movie", "tt0137523");
    const body = await response.json();

    expect(body.streams).toHaveLength(2);
    expect(body.streams[0].name).toBe("DMM Flix");
    expect(body.streams[0].title).toBe("Server Alpha");
    expect(body.streams[0].url).toBe(STREAM_RESPONSE.source);
    expect(body.streams[0].behaviorHints.proxyHeaders.request.Referer).toBe(
      "https://embed.su/"
    );
    expect(body.streams[0].behaviorHints.proxyHeaders.request.Origin).toBe(
      "https://embed.su"
    );
    // Should include subtitles
    expect(body.streams[0].subtitles).toHaveLength(1);
    expect(body.streams[0].subtitles[0].lang).toBe("English");
  });

  it("returns empty streams for unknown IMDB ID", async () => {
    mockQueryResult = [[], []];

    // TMDB find also returns nothing
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("/find/")) {
        return new Response(
          JSON.stringify({ movie_results: [], tv_results: [] })
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const response = await handleStream("movie", "tt9999999");
    const body = await response.json();

    expect(body.streams).toEqual([]);
  });

  it("falls back to TMDB API when DB is unavailable", async () => {
    mockDbShouldThrow = true;

    const embedHtml = makeEmbedHtml(TEST_SERVERS);
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      // TMDB find endpoint returns Fight Club
      if (url.includes("/find/tt0137523")) {
        return new Response(
          JSON.stringify({
            movie_results: [{ id: 550, title: "Fight Club" }],
            tv_results: [],
          })
        );
      }
      if (url.includes("/api/e/")) {
        return new Response(JSON.stringify(STREAM_RESPONSE));
      }
      return new Response(embedHtml, { status: 200 });
    }) as typeof fetch;

    const response = await handleStream("movie", "tt0137523");
    const body = await response.json();

    expect(body.streams).toHaveLength(2);
    expect(body.streams[0].url).toBe(STREAM_RESPONSE.source);
  });

  it("returns empty streams for invalid ID format", async () => {
    const response = await handleStream("movie", "notanid");
    const body = await response.json();

    expect(body.streams).toEqual([]);
  });

  it("returns empty streams for unsupported media type", async () => {
    const response = await handleStream("podcast", "tt0137523");
    const body = await response.json();

    expect(body.streams).toEqual([]);
  });

  it("handles series with season and episode", async () => {
    mockQueryResult = [[{ tmdb_id: 1396, title: "Breaking Bad" }], []];

    const embedHtml = makeEmbedHtml(TEST_SERVERS);
    const calls: string[] = [];

    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/e/")) {
        return new Response(
          JSON.stringify({
            source: "https://cdn.example.com/bb_s1e1.m3u8",
            subtitles: [],
            format: "hls",
          })
        );
      }
      return new Response(embedHtml, { status: 200 });
    }) as typeof fetch;

    const response = await handleStream("series", "tt0903747:1:1");
    const body = await response.json();

    expect(body.streams).toHaveLength(2);
    expect(body.streams[0].url).toBe("https://cdn.example.com/bb_s1e1.m3u8");

    // Verify the TV embed path was called
    const embedCall = calls.find((c) => c.includes("/embed/"));
    expect(embedCall).toContain("/embed/tv/1396/1/1");
  });

  it("returns empty streams for series without season/episode", async () => {
    const response = await handleStream("series", "tt0903747");
    const body = await response.json();

    expect(body.streams).toEqual([]);
  });

  it("returns empty streams when embed.su fails", async () => {
    mockQueryResult = [[{ tmdb_id: 550, title: "Fight Club" }], []];

    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      // DB succeeds so TMDB find won't be called, but embed.su fails
      if (url.includes("embed.su")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const response = await handleStream("movie", "tt0137523");
    const body = await response.json();

    expect(body.streams).toEqual([]);
  });

  it("produces consistent bingeGroup across episodes for auto-next-episode", async () => {
    mockQueryResult = [[{ tmdb_id: 1396, title: "Breaking Bad" }], []];

    const embedHtml = makeEmbedHtml(TEST_SERVERS);
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("/api/e/")) {
        return new Response(
          JSON.stringify({
            source: "https://cdn.example.com/stream.m3u8",
            subtitles: [],
            format: "hls",
          })
        );
      }
      return new Response(embedHtml, { status: 200 });
    }) as typeof fetch;

    // Request S01E01 and S01E02
    const res1 = await handleStream("series", "tt0903747:1:1");
    const body1 = await res1.json();
    const res2 = await handleStream("series", "tt0903747:1:2");
    const body2 = await res2.json();

    expect(body1.streams.length).toBeGreaterThan(0);
    expect(body2.streams.length).toBeGreaterThan(0);

    // Every stream must have a bingeGroup
    for (const s of [...body1.streams, ...body2.streams]) {
      expect(s.behaviorHints.bingeGroup).toBeTruthy();
    }

    // bingeGroups for the same server must match across episodes
    const groups1 = body1.streams.map(
      (s: any) => s.behaviorHints.bingeGroup
    );
    const groups2 = body2.streams.map(
      (s: any) => s.behaviorHints.bingeGroup
    );
    expect(groups1).toEqual(groups2);

    // bingeGroup must be deterministic (based on server name, not episode-specific)
    expect(groups1[0]).toBe("dmm-flix-Server Alpha");
    expect(groups1[1]).toBe("dmm-flix-Server Beta");
  });
});

// ===========================================================================
// Live stream playability — hits real embed.su, no mocks
// ===========================================================================
describe("live stream playability", () => {
  const EMBED_HEADERS = {
    Referer: "https://embed.su/",
    Origin: "https://embed.su",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  async function isEmbedSuReachable(): Promise<boolean> {
    try {
      const res = await originalFetch("https://embed.su/", {
        method: "HEAD",
        headers: EMBED_HEADERS,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok || res.status === 403 || res.status === 301;
    } catch {
      return false;
    }
  }

  it("resolves a real movie and returns a playable HLS manifest", async () => {
    globalThis.fetch = originalFetch;

    const reachable = await isEmbedSuReachable();
    if (!reachable) {
      console.log("  ⊘ embed.su is not reachable — skipping live test");
      return;
    }

    // TMDB 550 = Fight Club
    const streams = await resolveStreams(550);

    console.log(`  resolved ${streams.length} server(s) from embed.su`);
    expect(streams.length).toBeGreaterThan(0);

    // Try each stream URL until we find one with a valid HLS manifest
    let validStream: (typeof streams)[0] | null = null;
    let manifestBody = "";

    for (const stream of streams) {
      expect(stream.url).toBeTruthy();
      expect(stream.name).toBeTruthy();

      try {
        const res = await fetch(stream.url, { headers: EMBED_HEADERS });

        if (!res.ok) {
          console.log(`  ${stream.name}: HTTP ${res.status} — skipping`);
          continue;
        }

        const body = await res.text();

        if (body.includes("#EXTM3U")) {
          validStream = stream;
          manifestBody = body;
          break;
        } else {
          console.log(`  ${stream.name}: response is not HLS — skipping`);
        }
      } catch (err) {
        console.log(`  ${stream.name}: fetch failed — skipping`);
      }
    }

    // At least one server must return a valid HLS manifest
    expect(validStream).not.toBeNull();
    console.log(`  ✓ ${validStream!.name} returned a valid HLS manifest`);

    // Validate manifest structure
    expect(manifestBody).toContain("#EXTM3U");
    const isMaster = manifestBody.includes("#EXT-X-STREAM-INF");
    const isMedia = manifestBody.includes("#EXTINF");
    expect(isMaster || isMedia).toBe(true);

    if (isMaster) {
      console.log(`  ✓ master playlist with variant streams`);
      // Fetch first variant to verify it's also valid
      const variantMatch = manifestBody.match(/^(https?:\/\/.+)$/m);
      if (variantMatch) {
        const variantRes = await fetch(variantMatch[1], {
          headers: EMBED_HEADERS,
        });
        expect(variantRes.ok).toBe(true);
        const variantBody = await variantRes.text();
        expect(variantBody).toContain("#EXTM3U");
        expect(variantBody).toContain("#EXTINF");
        console.log(`  ✓ variant playlist contains media segments`);
      }
    } else {
      console.log(
        `  ✓ media playlist with ${(manifestBody.match(/#EXTINF/g) || []).length} segment(s)`
      );
    }
  }, 30000);
});
