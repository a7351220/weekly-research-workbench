import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { handleAppRequest, hasEditorialSecrets, refreshEditorialCacheForRuntime } from "./app";
import { InMemoryCacheStore } from "./cache";
import type { Env } from "./types";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const cache = new InMemoryCacheStore();

const env: Env = {
  API_KEY: process.env.API_KEY,
  BLOCKBEATS_API_KEY: process.env.BLOCKBEATS_API_KEY,
  OPENNEWS_TOKEN: process.env.OPENNEWS_TOKEN,
  TWITTER_TOKEN: process.env.TWITTER_TOKEN,
  FMP_API_KEY: process.env.FMP_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_TRANSLATION_MODEL: process.env.OPENROUTER_TRANSLATION_MODEL,
  EDITORIAL_CACHE: cache,
};

const app = new Hono();

app.all("*", async (c) => handleAppRequest(c.req.raw, env));

if (hasEditorialSecrets(env) && process.env.ENABLE_EDITORIAL_SCHEDULER !== "false") {
  const intervalMs = Number.parseInt(
    process.env.EDITORIAL_REFRESH_INTERVAL_MS ?? `${60 * 60 * 1000}`,
    10,
  );

  void refreshEditorialCacheForRuntime(env).catch((error) => {
    console.error("[editorial-cache:init]", error);
  });

  const timer = setInterval(() => {
    void refreshEditorialCacheForRuntime(env).catch((error) => {
      console.error("[editorial-cache:tick]", error);
    });
  }, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60 * 60 * 1000);

  timer.unref();
}

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`us-daily-market-report node server listening on http://localhost:${info.port}`);
  },
);
