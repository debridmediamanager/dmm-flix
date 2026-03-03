import { config } from "./config";
import { router } from "./router";

const server = Bun.serve({
  port: config.port,
  fetch: router,
});

console.log(`DMM Flix addon running at http://localhost:${server.port}`);
