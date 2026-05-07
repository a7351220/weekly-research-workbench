import { handleAppRequest, refreshEditorialCacheForRuntime } from "./app";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleAppRequest(request, env);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshEditorialCacheForRuntime(env));
  },
} satisfies ExportedHandler<Env>;
