import { handleDailyUs } from "./daily-us";
import { handleDailyUsPoster } from "./daily-us-poster";
import { handleDailyTaiwan, handleTaiwanSources } from "./daily-taiwan";
import { handleTaiwanIndustryMap, handleTaiwanStockIndustryProfile } from "./taiwan-industry-map";
import { handleTaiwanTestPage } from "./taiwan-test-page";
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
  "/daily/taiwan",
  "/daily/taiwan.json",
  "/taiwan",
  "/taiwan.html",
  "/taiwan/sources.json",
  "/taiwan/industry-map.json",
  "/taiwan/stock.json",
  "/taiwan/stock/{symbol}.json",
  "/daily/taiwan/sources.json",
  "/daily/us-poster",
  "/daily/us-poster.json",
  "/daily/us-poster.html",
  "/daily/us-poster.svg",
  "/daily/us-poster.md",
  "/daily/us-poster.txt",
  "/daily/print",
  "/daily/print.html",
  "/daily/us-print",
  "/daily/us-print.html",
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
    case "/daily/taiwan":
    case "/daily/taiwan.json":
      return handleDailyTaiwan(request, env);
    case "/taiwan":
    case "/taiwan.html":
      return handleTaiwanTestPage();
    case "/taiwan/sources.json":
    case "/daily/taiwan/sources.json":
      return handleTaiwanSources();
    case "/taiwan/industry-map.json":
      return handleTaiwanIndustryMap(request, env);
    case "/taiwan/stock.json":
      return handleTaiwanStockIndustryProfile(request, env);
    case "/daily":
    case "/daily.html":
    case "/daily/us-poster":
    case "/daily/us-poster.json":
    case "/daily/us-poster.html":
    case "/daily/us-poster.svg":
    case "/daily/us-poster.md":
    case "/daily/us-poster.txt":
    case "/daily/print":
    case "/daily/print.html":
    case "/daily/us-print":
    case "/daily/us-print.html":
    case "/daily/calendar":
    case "/daily/us-calendar":
    case "/daily/us-calendar.html":
      return handleDailyUsPoster(request, env);
    default:
      if (/^\/taiwan\/stock\/\d{4,6}(?:\.json)?$/.test(url.pathname)) {
        return handleTaiwanStockIndustryProfile(request, env);
      }
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
  return env.ENABLE_PRIVATE_NEWS === "true" && Boolean(env.BLOCKBEATS_API_KEY || env.OPENNEWS_TOKEN || env.TWITTER_TOKEN);
}
