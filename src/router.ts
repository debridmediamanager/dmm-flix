import { handleManifest } from "./routes/manifest";
import { handleStream } from "./routes/stream";
import { corsJson, corsOptions } from "./utils/cors";

export async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return corsOptions();
  }

  if (req.method !== "GET") {
    return corsJson({ error: "Method not allowed" }, 405);
  }

  // GET /manifest.json
  if (path === "/manifest.json" || path === "/") {
    return handleManifest();
  }

  // GET /stream/:type/:id.json
  const streamMatch = path.match(
    /^\/stream\/(movie|series)\/(.+)\.json$/
  );
  if (streamMatch) {
    const [, mediaType, id] = streamMatch;
    try {
      return await handleStream(mediaType, id);
    } catch (err) {
      console.error("Stream error:", err);
      return corsJson({ streams: [] });
    }
  }

  return corsJson({ error: "Not found" }, 404);
}
