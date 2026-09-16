"""Measure every stairway once and cache the result in the repository.

The site used to ask Google for an elevation profile on each page view, which made
every detail panel depend on a live API call. This script does the measuring ahead
of time and writes src/stairway-metrics.json, so the browser only reads bundled data.

Two sources do the work:

  * OpenStreetMap supplies the real geometry of each staircase (highway=steps) and,
    where a surveyor has counted them, an authoritative step_count tag.
  * The USGS 3DEP elevation service samples the terrain along that geometry. Over San
    Francisco it answers from a 1 metre lidar surface, which resolves a single flight
    of stairs that a coarser global model would flatten.

Usage:
    python3 scripts/build-stairway-metrics.py
    python3 scripts/build-stairway-metrics.py --refresh-osm     # re-download geometry
    python3 scripts/build-stairway-metrics.py --google-key KEY  # sample Google instead

Network results are cached under data/cache/, so a re-run costs nothing.
"""

import argparse
import json
import math
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/cache'
OSM_CACHE = CACHE / 'osm-steps.json'
ELEVATION_CACHE = CACHE / 'elevation-samples.json'
OUTPUT = ROOT / 'src/stairway-metrics.json'

BBOX = '37.705,-122.518,37.832,-122.35'
OVERPASS_QUERY = f'[out:json][timeout:180];way[highway=steps]({BBOX});out geom;'
OVERPASS_HOSTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]
USER_AGENT = 'SFStairs/1.0 (https://sf-stairs-map.lizzie-siegle5086.workers.dev)'

# A stairway is matched to OSM geometry within this many metres of its mapped point.
MATCH_RADIUS_M = 70
# Separate flights of the same staircase are bridged across gaps up to this size. At 25 m
# the 16th Avenue Tiled Steps and the Lyon Street Steps come out whole; past about 30 m
# neighbouring staircases start merging into each other.
GAP_METRES = 25
# Terrain is sampled at least this often along a staircase, capped per staircase.
SAMPLE_SPACING_M = 8
MAX_SAMPLES_PER_STAIRWAY = 60
# Fallback riser heights if calibration cannot run; replaced by measured medians.
DEFAULT_RISER_INCHES = (6.0, 7.0)
# Short flights sit in gardens and parks and use shallower risers than the long
# hillside runs, so the riser is calibrated on each side of this rise.
RISER_SPLIT_FEET = 10
# Staircases with fewer steps than this are too short to calibrate against.
MIN_CALIBRATION_STEPS = 8
FEET_PER_METRE = 3.28084


def log(message):
    print(message, file=sys.stderr, flush=True)


def metres(a, b):
    """Planar distance in metres, accurate enough at San Francisco's latitude."""
    return math.hypot((a[0] - b[0]) * 111195, (a[1] - b[1]) * 87950)


# --------------------------------------------------------------------------- OSM

def load_osm_steps(refresh):
    if OSM_CACHE.exists() and not refresh:
        log(f'using cached OSM geometry ({OSM_CACHE.relative_to(ROOT)})')
        return json.loads(OSM_CACHE.read_text())
    for host in OVERPASS_HOSTS:
        try:
            log(f'downloading staircase geometry from {host}')
            url = host + '?' + urllib.parse.urlencode({'data': OVERPASS_QUERY})
            request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(request, timeout=240) as response:
                raw = response.read()
            payload = json.loads(raw)
            if payload.get('remark'):
                raise ValueError(payload['remark'])
            CACHE.mkdir(parents=True, exist_ok=True)
            OSM_CACHE.write_bytes(raw)
            return payload
        except Exception as error:
            log(f'  {host} failed: {error!r}')
    raise SystemExit('Could not reach any Overpass mirror. Try again later.')


def staircase_components(payload, gap_metres=0):
    """Group connected highway=steps ways into one component per physical staircase.

    OSM splits a long stairway wherever a landing or a tag changes, so a component is
    the unit that matches what a walker would call a single set of stairs. Ways that
    share a node always belong together. `gap_metres` additionally bridges flights that
    are drawn as separate ways with a landing between them - the 16th Avenue Tiled
    Steps are mapped as a dozen unconnected flights of nine to twelve steps each.
    """
    ways = [e for e in payload['elements'] if e['type'] == 'way' and e.get('geometry')]
    parent = list(range(len(ways)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    shared = defaultdict(list)
    for index, way in enumerate(ways):
        for point in way['geometry']:
            shared[(round(point['lat'], 7), round(point['lon'], 7))].append(index)
    for members in shared.values():
        for other in members[1:]:
            union(members[0], other)

    if gap_metres:
        cell = gap_metres / 111195
        grid = defaultdict(set)
        geometry = [[(p['lat'], p['lon']) for p in w['geometry']] for w in ways]
        for index, points in enumerate(geometry):
            for point in points:
                grid[(int(point[0] / cell), int(point[1] / cell))].add(index)
        for index, points in enumerate(geometry):
            nearby = set()
            for point in points:
                gi, gj = int(point[0] / cell), int(point[1] / cell)
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        nearby |= grid.get((gi + di, gj + dj), set())
            for other in nearby:
                if other <= index or find(other) == find(index):
                    continue
                if any(metres(a, b) <= gap_metres for a in points for b in geometry[other]):
                    union(index, other)

    grouped = defaultdict(list)
    for index in range(len(ways)):
        grouped[find(index)].append(index)

    components = []
    for members in grouped.values():
        segments, points, counted, run = [], [], [], 0.0
        for index in members:
            geometry = [(p['lat'], p['lon']) for p in ways[index]['geometry']]
            segments.append(geometry)
            points.extend(geometry)
            run += sum(metres(a, b) for a, b in zip(geometry, geometry[1:]))
            tag = ways[index].get('tags', {}).get('step_count', '').strip()
            if re.fullmatch(r'\d+', tag):
                counted.append(int(tag))
        names = {ways[i].get('tags', {}).get('name', '') for i in members} - {''}
        components.append({
            'segments': segments,
            'points': points,
            'run': run,
            'names': names,
            'osmWays': sorted(ways[i]['id'] for i in members),
            # Only trust a total when every way in the staircase was counted.
            'steps': sum(counted) if len(counted) == len(members) else None,
        })
    return components


# ---------------------------------------------------------------------- matching

NAME_STOPWORDS = {
    'the', 'and', 'to', 'at', 'from', 'of', 'st', 'street', 'ave', 'avenue', 'stairway',
    'stairs', 'steps', 'stairways', 'walk', 'way', 'blvd', 'dr', 'drive', 'ct', 'court',
    'pl', 'place', 'ter', 'terrace', 'rd', 'road', 'sf', 'san', 'francisco', 'in', 'no',
    'nice', 'views', 'view', 'park', 'near', 'between', 'off', 'end',
}


def name_tokens(text):
    return {t for t in re.findall(r'[a-z]+', text.lower())
            if len(t) > 2 and t not in NAME_STOPWORDS}


class ComponentIndex:
    """Spatial buckets so each stairway only tests nearby staircases."""

    BUCKET = 0.0025  # roughly 275 m

    def __init__(self, components):
        self.components = components
        self.grid = defaultdict(set)
        self.tokens = []
        for index, component in enumerate(components):
            for point in component['points']:
                self.grid[(int(point[0] / self.BUCKET), int(point[1] / self.BUCKET))].add(index)
            merged = set()
            for name in component['names']:
                merged |= name_tokens(name)
            self.tokens.append(merged)

    def match(self, stair):
        point = (stair['lat'], stair['lng'])
        gi, gj = int(point[0] / self.BUCKET), int(point[1] / self.BUCKET)
        nearby = set()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                nearby |= self.grid.get((gi + di, gj + dj), set())

        wanted = name_tokens(f"{stair['name']} {stair.get('mapName', '')}")
        best, best_score, best_distance = None, -math.inf, None
        for index in nearby:
            component = self.components[index]
            distance = min(metres(point, p) for p in component['points'])
            if distance > MATCH_RADIUS_M:
                continue
            # Prefer the staircase that is close, substantial, named like the entry,
            # and already surveyed - in that order of influence.
            score = (-distance * 0.6
                     + min(component['run'], 200) * 0.5
                     + len(wanted & self.tokens[index]) * 60
                     + (25 if component['steps'] else 0))
            if score > best_score:
                best, best_score, best_distance = index, score, distance
        return (best, best_distance)


# --------------------------------------------------------------------- elevation

def densify(segments):
    """Walk each segment, adding points so terrain is sampled at least every 8 m."""
    points = []
    for geometry in segments:
        for a, b in zip(geometry, geometry[1:]):
            points.append(a)
            steps = int(metres(a, b) // SAMPLE_SPACING_M)
            for n in range(1, steps):
                t = n / steps
                points.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        if geometry:
            points.append(geometry[-1])

    unique = list(dict.fromkeys((round(p[0], 6), round(p[1], 6)) for p in points))
    if len(unique) <= MAX_SAMPLES_PER_STAIRWAY:
        return unique
    stride = len(unique) / MAX_SAMPLES_PER_STAIRWAY
    thinned = [unique[int(i * stride)] for i in range(MAX_SAMPLES_PER_STAIRWAY)]
    thinned[-1] = unique[-1]
    return list(dict.fromkeys(thinned))


def usgs_sample(point):
    url = ('https://epqs.nationalmap.gov/v1/json?'
           + urllib.parse.urlencode({'x': point[1], 'y': point[0], 'wkid': 4326,
                                     'units': 'Feet', 'includeDate': 'false'}))
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    value = payload.get('value')
    if value is None:
        raise ValueError('no elevation returned')
    return (float(value), float(payload.get('resolution') or 0))


def google_sample_batch(points, key):
    url = ('https://maps.googleapis.com/maps/api/elevation/json?'
           + urllib.parse.urlencode({
               'locations': '|'.join(f'{p[0]},{p[1]}' for p in points), 'key': key}))
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get('status') != 'OK':
        raise ValueError(payload.get('error_message') or payload.get('status'))
    return [(r['elevation'] * FEET_PER_METRE, float(r.get('resolution') or 0))
            for r in payload['results']]


def sample_elevations(points, google_key):
    """Return {point: (feet, resolution)}, reusing anything already cached on disk."""
    cached = {}
    if ELEVATION_CACHE.exists():
        cached = json.loads(ELEVATION_CACHE.read_text())
    source = 'google' if google_key else 'usgs-3dep'
    store = cached.setdefault(source, {})

    pending = [p for p in points if f'{p[0]},{p[1]}' not in store]
    log(f'{len(points)} sample points, {len(points) - len(pending)} cached, '
        f'{len(pending)} to fetch from {source}')

    started, done = time.time(), 0
    if google_key:
        for start in range(0, len(pending), 300):
            batch = pending[start:start + 300]
            for point, value in zip(batch, google_sample_batch(batch, google_key)):
                store[f'{point[0]},{point[1]}'] = value
            done += len(batch)
            log(f'  {done}/{len(pending)}')
    else:
        def fetch(point):
            for attempt in range(4):
                try:
                    return point, usgs_sample(point)
                except Exception:
                    time.sleep(1 + attempt * 2)
            return point, None

        with ThreadPoolExecutor(8) as pool:
            for point, value in pool.map(fetch, pending):
                done += 1
                if value is not None:
                    store[f'{point[0]},{point[1]}'] = value
                if done % 500 == 0:
                    rate = done / max(time.time() - started, 1e-9)
                    log(f'  {done}/{len(pending)} ({rate:.0f}/s)')

    CACHE.mkdir(parents=True, exist_ok=True)
    ELEVATION_CACHE.write_text(json.dumps(cached, separators=(',', ':')))
    return {p: tuple(store[f'{p[0]},{p[1]}']) for p in points if f'{p[0]},{p[1]}' in store}


# ------------------------------------------------------------------------- build

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-osm', action='store_true',
                        help='re-download staircase geometry instead of using the cache')
    parser.add_argument('--google-key',
                        help='sample the Google Elevation API instead of USGS 3DEP')
    parser.add_argument('--gap', type=float, default=GAP_METRES,
                        help='bridge flights drawn as separate ways within this many metres')
    args = parser.parse_args()

    payload = load_osm_steps(args.refresh_osm)
    components = staircase_components(payload, args.gap)
    log(f'{len(components)} staircases in OpenStreetMap')

    stairs = json.loads((ROOT / 'src/stairs.json').read_text())['stairs']
    mapped = [s for s in stairs if s['lat'] is not None and s['lng'] is not None]
    index = ComponentIndex(components)

    matches = {}
    for stair in mapped:
        component, distance = index.match(stair)
        if component is not None:
            matches[stair['id']] = (component, round(distance))
    log(f'{len(matches)} of {len(mapped)} mapped stairways matched a staircase')

    # Sample every matched staircase once, even when several entries share it.
    needed, per_component = [], {}
    for component_index in sorted({c for c, _ in matches.values()}):
        points = densify(components[component_index]['segments'])
        per_component[component_index] = points
        needed.extend(points)
    elevations = sample_elevations(list(dict.fromkeys(needed)), args.google_key)

    measured = {}
    for component_index, points in per_component.items():
        found = [elevations[p] for p in points if p in elevations]
        if len(found) < 2:
            continue
        feet = [f for f, _ in found]
        measured[component_index] = {
            'riseFeet': max(feet) - min(feet),
            'topFeet': max(feet),
            'bottomFeet': min(feet),
            'samples': len(found),
            # Coarse readings come back in degrees; report metres either way.
            'resolutionMeters': min(r if r > 1e-3 else r * 111195 for _, r in found),
        }
    log(f'{len(measured)} staircases measured')

    # Calibrate riser height against every staircase OSM has already counted.
    truth = [(metrics['riseFeet'], components[i]['steps'])
             for i, metrics in measured.items()
             if components[i]['steps'] and components[i]['steps'] >= MIN_CALIBRATION_STEPS
             and metrics['riseFeet'] > 1]
    short = [rise * 12 / steps for rise, steps in truth if rise < RISER_SPLIT_FEET]
    tall = [rise * 12 / steps for rise, steps in truth if rise >= RISER_SPLIT_FEET]
    risers = (round(statistics.median(short), 2) if len(short) >= 20 else DEFAULT_RISER_INCHES[0],
              round(statistics.median(tall), 2) if len(tall) >= 20 else DEFAULT_RISER_INCHES[1])
    log(f'risers calibrated to {risers[0]} in below {RISER_SPLIT_FEET} ft and '
        f'{risers[1]} in above, from {len(truth)} counted staircases')

    def estimate(rise_feet):
        riser = risers[0] if rise_feet < RISER_SPLIT_FEET else risers[1]
        return max(1, round(rise_feet * 12 / riser))

    errors = [abs(estimate(rise) - steps) / steps for rise, steps in truth]

    stairways = {}
    mismatched = []
    for stair in mapped:
        match = matches.get(stair['id'])
        if not match:
            continue
        component_index, distance = match
        metrics = measured.get(component_index)
        if not metrics:
            continue
        component = components[component_index]
        rise_feet = round(metrics['riseFeet'])
        run_feet = round(component['run'] * FEET_PER_METRE)

        index_steps = stair['steps'].strip()
        if re.fullmatch(r'\d+', index_steps):
            counted = int(index_steps)
            implied = estimate(metrics['riseFeet'])
            # "A few steps in the sidewalk" can sit within 70 m of a long hillside flight.
            # When the counted and measured staircases disagree this badly they are not the
            # same structure, so the count is kept and the mismatched geometry dropped.
            if abs(implied - counted) > 20 and max(implied, counted) > 3 * min(implied, counted):
                mismatched.append((stair['name'], counted, implied))
                continue
            steps, step_source = counted, 'index'
        elif component['steps']:
            steps, step_source = component['steps'], 'osm-survey'
        else:
            steps, step_source = estimate(metrics['riseFeet']), 'rise-estimate'

        stairways[stair['id']] = {
            'riseFeet': rise_feet,
            'runFeet': run_feet,
            'grade': round(rise_feet / run_feet, 3) if run_feet else None,
            'steps': steps,
            'stepSource': step_source,
            'topFeet': round(metrics['topFeet']),
            'bottomFeet': round(metrics['bottomFeet']),
            'samples': metrics['samples'],
            'resolutionMeters': round(metrics['resolutionMeters'], 1),
            'matchMeters': distance,
            'osmWays': component['osmWays'],
        }

    result = {
        'version': 1,
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'elevationSource': 'Google Elevation API' if args.google_key
                           else 'USGS 3DEP (The National Map)',
        'geometrySource': '© OpenStreetMap contributors, ODbL 1.0',
        'osmTimestamp': payload.get('osm3s', {}).get('timestamp_osm_base'),
        'gapMetres': args.gap,
        'riserInches': {'short': risers[0], 'tall': risers[1], 'splitFeet': RISER_SPLIT_FEET},
        'calibration': {
            'countedStairways': len(truth),
            'medianRelativeError': round(statistics.median(errors), 3) if errors else None,
        },
        'stairways': dict(sorted(stairways.items())),
    }
    OUTPUT.write_text(json.dumps(result, separators=(',', ':'), sort_keys=False))

    for name, counted, implied in mismatched:
        log(f'  dropped mismatched geometry: {name[:58]} (index {counted}, measured {implied})')

    sources = defaultdict(int)
    for entry in stairways.values():
        sources[entry['stepSource']] += 1
    print(json.dumps({
        'stairways': len(stairways),
        'mismatchedDropped': len(mismatched),
        'stepSources': dict(sources),
        'riserInches': risers,
        'medianRelativeError': result['calibration']['medianRelativeError'],
        'bytes': OUTPUT.stat().st_size,
    }, indent=2))


if __name__ == '__main__':
    main()
