interface Env {
  ASSETS: Fetcher;
  GOOGLE_MAPS_API_KEY: string;
  VERIFICATION_REPORTS: KVNamespace;
}

type Coordinates = { lat: number; lng: number };

function json(body: unknown, status = 200, cacheControl = 'public, max-age=86400') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': cacheControl } });
}

function endpointFromDescription(description: string) {
  const match = description.match(/\b(?:to|into|down to|up to)\s+(.+?)(?:[.;]|$)/i);
  if (!match) return null;
  const endpoint = match[1].replace(/\b(?:near|at)\s+the\s+end\s+of\s+the\s+stairs?\b/ig, '').replace(/\s+/g, ' ').trim();
  return endpoint.length >= 3 ? `${endpoint}, San Francisco, CA` : null;
}

async function geocode(address: string, key: string): Promise<{ point: Coordinates; label: string } | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('components', 'locality:San Francisco|administrative_area:CA|country:US');
  url.searchParams.set('key', key);
  const response = await fetch(url);
  const payload = await response.json() as { status: string; error_message?: string; results?: { formatted_address: string; geometry: { location: Coordinates } }[] };
  if (payload.status === 'ZERO_RESULTS') return null;
  if (payload.status !== 'OK' || !payload.results?.[0]) {
    if (payload.error_message?.includes('not activated')) throw new Error('Enable the Google Geocoding API for this key, then try again.');
    throw new Error(payload.error_message || 'Google could not geocode this stairway description.');
  }
  return { point: payload.results[0].geometry.location, label: payload.results[0].formatted_address };
}

async function elevationPath(origin: Coordinates, destination: Coordinates, key: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/elevation/json');
  url.searchParams.set('path', `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`);
  url.searchParams.set('samples', '24');
  url.searchParams.set('key', key);
  const response = await fetch(url);
  const payload = await response.json() as { status: string; error_message?: string; results?: { elevation: number }[] };
  if (payload.status !== 'OK' || !payload.results?.length) {
    if (payload.error_message?.includes('not activated')) throw new Error('Enable the Google Elevation API for this key, then try again.');
    throw new Error(payload.error_message || 'Google could not calculate elevation for this stairway.');
  }
  const elevations = payload.results.map(result => result.elevation);
  const uphillMeters = elevations.slice(1).reduce((total, elevation, index) => total + Math.max(0, elevation - elevations[index]), 0);
  const downhillMeters = elevations.slice(1).reduce((total, elevation, index) => total + Math.max(0, elevations[index] - elevation), 0);
  return {
    gainFeet: Math.round(uphillMeters * 3.28084),
    descentFeet: Math.round(downhillMeters * 3.28084),
    verticalFeet: Math.round((uphillMeters + downhillMeters) * 3.28084),
    startFeet: Math.round(elevations[0] * 3.28084),
    endFeet: Math.round(elevations.at(-1)! * 3.28084)
  };
}

function nearbyPoints(center: Coordinates) {
  const latitudeMeters = 1 / 111195;
  const longitudeMeters = 1 / (111195 * Math.cos(center.lat * Math.PI / 180));
  return [0, 45, 90, 135, 180, 225, 270, 315].map(degrees => {
    const radians = degrees * Math.PI / 180;
    return { lat: center.lat + Math.cos(radians) * 45 * latitudeMeters, lng: center.lng + Math.sin(radians) * 45 * longitudeMeters };
  });
}

async function localElevationRange(center: Coordinates, key: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/elevation/json');
  url.searchParams.set('locations', [...nearbyPoints(center), center].map(point => `${point.lat},${point.lng}`).join('|'));
  url.searchParams.set('key', key);
  const response = await fetch(url);
  const payload = await response.json() as { status: string; error_message?: string; results?: { elevation: number }[] };
  if (payload.status !== 'OK' || !payload.results?.length) throw new Error(payload.error_message || 'Google could not calculate local elevation for this stairway.');
  const elevations = payload.results.map(result => result.elevation);
  return {
    gainFeet: Math.round((Math.max(...elevations) - Math.min(...elevations)) * 3.28084),
    startFeet: Math.round(elevations.at(-1)! * 3.28084),
    endFeet: Math.round(Math.max(...elevations) * 3.28084)
  };
}

function estimatedSteps(verticalFeet: number) {
  return Math.max(1, Math.round(verticalFeet * 12 / 7));
}

async function estimateElevation(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const description = url.searchParams.get('description') || '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || description.length > 500) return json({ error: 'A mapped stairway description is required.' }, 400, 'no-store');
  const inferredAddress = endpointFromDescription(description);
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    if (inferredAddress) {
      const endpoint = await geocode(inferredAddress, env.GOOGLE_MAPS_API_KEY);
      if (endpoint) {
        const elevation = await elevationPath({ lat, lng }, endpoint.point, env.GOOGLE_MAPS_API_KEY);
        const response = json({ available: true, method: 'inferred-path', endpoint: endpoint.label, inferredFrom: inferredAddress, estimatedSteps: estimatedSteps(elevation.verticalFeet), ...elevation });
        ctx.waitUntil(cache.put(request, response.clone()));
        return response;
      }
    }
    const elevation = await localElevationRange({ lat, lng }, env.GOOGLE_MAPS_API_KEY);
    const response = json({ available: true, method: 'local-range', estimatedSteps: estimatedSteps(elevation.gainFeet), ...elevation });
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    return json({ available: false, reason: error instanceof Error ? error.message : 'Elevation data is unavailable.' }, 502, 'no-store');
  }
}

async function saveVerificationReport(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, 'no-store');
  const report = await request.json().catch(() => null) as { stairId?: string; type?: string; details?: string; contact?: string } | null;
  if (!report?.stairId || !['location', 'access', 'duplicate', 'photo', 'other'].includes(report.type || '') || !report.details?.trim() || report.details.length > 1500 || (report.contact?.length || 0) > 254) return json({ error: 'Please include the stairway and a short report.' }, 400, 'no-store');
  const id = crypto.randomUUID();
  await env.VERIFICATION_REPORTS.put(`report:${Date.now()}:${id}`, JSON.stringify({ id, stairId: report.stairId, type: report.type, details: report.details.trim(), contact: report.contact?.trim() || null, submittedAt: new Date().toISOString(), status: 'pending' }));
  return json({ accepted: true }, 202, 'no-store');
}

export default {
  fetch(request, env, ctx): Promise<Response> | Response {
    if (new URL(request.url).pathname === '/api/elevation') return estimateElevation(request, env, ctx);
    if (new URL(request.url).pathname === '/api/verification-reports') return saveVerificationReport(request, env);
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
