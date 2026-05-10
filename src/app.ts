import { handleDailyUs } from "./daily-us";
import { handleDailyUsPoster } from "./daily-us-poster";
import { OPENAPI_DAILY_YAML } from "./openapi";
import { refreshEditorialCache } from "./signals";
import type { Env } from "./types";
import { handleOptions, jsonResponse } from "./utils";

const DAILY_ENDPOINTS = [
  "/health",
  "/openapi.yaml",
  "/openapi-daily.yaml",
  "/daily",
  "/daily.html",
  "/daily/us",
  "/daily/us.json",
  "/daily/us-poster",
  "/daily/us-poster.json",
  "/daily/us-poster.html",
  "/daily/us-poster.svg",
  "/daily/us-poster.md",
  "/daily/us-poster.txt",
  "/daily/calendar",
  "/daily/us-calendar",
  "/daily/us-calendar.html",
];

export async function handleAppRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET") {
    return jsonResponse(
      { ok: false, error: "Method not allowed" },
      { status: 405 },
    );
  }

  const url = new URL(request.url);

  switch (url.pathname) {
    case "/health":
      return jsonResponse({
        ok: true,
        service: "us-daily-market-report",
        generatedAt: new Date().toISOString(),
      });
    case "/openapi.yaml":
    case "/openapi-daily.yaml":
      return new Response(OPENAPI_DAILY_YAML, {
        headers: {
          "content-type": "application/yaml; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    case "/daily/us":
    case "/daily/us.json":
      return handleDailyUs(request, env);
    case "/daily":
    case "/daily.html":
    case "/daily/us-poster":
    case "/daily/us-poster.json":
    case "/daily/us-poster.html":
    case "/daily/us-poster.svg":
    case "/daily/us-poster.md":
    case "/daily/us-poster.txt":
    case "/daily/calendar":
    case "/daily/us-calendar":
    case "/daily/us-calendar.html":
      return handleDailyUsPoster(request, env);
    default:
      return jsonResponse(
        {
          ok: false,
          error: "Not found",
          availableEndpoints: DAILY_ENDPOINTS,
        },
        { status: 404 },
      );
  }
}

export async function refreshEditorialCacheForRuntime(env: Env): Promise<void> {
  await refreshEditorialCache(env);
}

export function hasEditorialSecrets(env: Env): boolean {
  return Boolean(env.BLOCKBEATS_API_KEY || env.OPENNEWS_TOKEN || env.TWITTER_TOKEN);
}
