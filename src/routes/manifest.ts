import { corsJson } from "../utils/cors";

const manifest = {
  id: "com.debridmediamanager.flix",
  name: "DMM Flix",
  description: "Free streaming addon powered by DMM Flix",
  version: "1.0.0",
  resources: [
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt"],
    },
  ],
  types: ["movie", "series"],
  catalogs: [],
  behaviorHints: {
    adult: false,
    p2p: false,
  },
};

export function handleManifest(): Response {
  return corsJson(manifest);
}
