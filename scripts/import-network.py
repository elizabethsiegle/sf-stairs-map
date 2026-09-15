import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUERY = '''[out:json][timeout:90];way[highway][highway!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|busway)$"][access!~"^(private|no)$"][foot!~"^(private|no)$"](37.705,-122.518,37.832,-122.35);out body;>;out body qt;'''
if len(sys.argv) > 1:
    source = json.loads(Path(sys.argv[1]).read_text())
else:
    url = 'https://overpass-api.de/api/interpreter?' + urllib.parse.urlencode({'data': QUERY})
    request = urllib.request.Request(url, headers={'User-Agent': 'SFStairs/1.0 (https://sf-stairs-map.lizzie-siegle5086.workers.dev)'})
    with urllib.request.urlopen(request, timeout=120) as response:
        source = json.load(response)
if source.get('remark'):
    raise ValueError(source['remark'])
allowed = {'residential', 'living_street', 'pedestrian', 'footway', 'path', 'steps', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'service', 'track', 'cycleway', 'bridleway'}
node_records = {n['id']: n for n in source['elements'] if n['type'] == 'node'}
positions = []
indices = {}
edges = set()
step_nodes = set()

def index(node_id):
    if node_id not in indices:
        n = node_records[node_id]
        indices[node_id] = len(positions)
        positions.append([round(n['lat'], 7), round(n['lon'], 7)])
    return indices[node_id]

def accessible(tags):
    return tags.get('foot', tags.get('access')) not in {'private', 'no', 'customers', 'permit'} and tags.get('indoor') != 'yes'

for way in source['elements']:
    if way['type'] != 'way':
        continue
    tags = way.get('tags', {})
    if tags.get('highway') not in allowed or not accessible(tags) or tags.get('area') == 'yes':
        continue
    if tags.get('foot:conditional') or tags.get('access:conditional'):
        continue
    direction = {'yes': 1, '1': 1, '-1': -1}.get(tags.get('oneway:foot', ''), 0)
    for left, right in zip(way['nodes'], way['nodes'][1:]):
        if left not in node_records or right not in node_records or left == right:
            continue
        if not all(accessible(node_records[n].get('tags', {})) for n in [left, right]):
            continue
        a, b = index(left), index(right)
        edges.add((a, b, direction))
        if tags['highway'] == 'steps':
            step_nodes.update([a, b])

import math

def meters(a, b):
    return math.hypot((a[0]-b[0])*111195, (a[1]-b[1])*87950)

stairs = json.loads((ROOT / 'src/stairs.json').read_text())['stairs']
snaps = {}
for stair in stairs:
    if stair['lat'] is None or stair['needsVerification']:
        continue
    if any(term in stair['name'].lower() for term in ['closed', 'private', 'no access']):
        continue
    point = [stair['lat'], stair['lng']]
    closest_step = min(step_nodes, key=lambda i: meters(point, positions[i]))
    closest = closest_step if meters(point, positions[closest_step]) <= 25 else min(range(len(positions)), key=lambda i: meters(point, positions[i]))
    offset = meters(point, positions[closest])
    if offset <= 60:
        snaps[stair['id']] = [closest, round(offset)]
network = {'version': 1, 'updatedAt': source['osm3s']['timestamp_osm_base'], 'attribution': '© OpenStreetMap contributors, ODbL 1.0', 'nodes': positions, 'edges': sorted(edges), 'snaps': snaps}
output = ROOT / 'public/walking-network.json'
output.write_text(json.dumps(network, separators=(',', ':')))
print(json.dumps({'nodes': len(positions), 'edges': len(edges), 'stairAccessPoints': len(snaps), 'bytes': output.stat().st_size}))
