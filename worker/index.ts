interface Env {
  ASSETS: Fetcher;
}

// Stairway rise and step counts are measured ahead of time by
// scripts/build-stairway-metrics.py and bundled as src/stairway-metrics.json, so the
// Worker only serves static assets. There is no elevation API to call, no key to keep,
// and nothing for the browser to parse at runtime.
export default {
  fetch(request, env): Promise<Response> | Response {
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
