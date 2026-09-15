import csv
import hashlib
import html
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NS = {'k': 'http://www.opengis.net/kml/2.2'}
COLORS = {'0288D1': 1, '558B2F': 2, '7CB342': 2, 'FFD600': 3, 'FFEA00': 3, 'F57C00': 4, 'E65100': 5, '000000': 0}

def normalize(value):
    return re.sub(r'\W', '', value).lower()

def urls(value):
    return list(dict.fromkeys(re.findall(r'https://photos\.app\.goo\.gl/[a-zA-Z0-9]+', value)))

rows = []
for number, row in enumerate(csv.reader((ROOT / 'data/stairs.csv').open()), 1):
    if len(row) < 6 or row[2] not in ['1', '2', '3', '4', '5']:
        continue
    rows.append({'row': number, 'name': row[3].strip(), 'neighborhood': row[1].strip(), 'rating': int(row[2]), 'steps': row[4].strip(), 'photos': urls(row[5]), 'photoNote': row[5].strip()})
by_name = {}
by_photo = {}
for row in rows:
    by_name.setdefault(normalize(row['name']), []).append(row)
    for url in row['photos']:
        by_photo.setdefault(url, []).append(row)
used = set()
entries = []
for place in ET.parse(ROOT / 'data/stairs.kml').findall('.//k:Placemark', NS):
    name = place.findtext('k:name', '', NS).strip()
    description = place.findtext('k:description', '', NS)
    photos = urls(description)
    candidates = by_name.get(normalize(name), [])
    match = candidates[0] if len(candidates) == 1 else None
    if not match:
        candidates = {r['row']: r for url in photos for r in by_photo.get(url, [])}
        if len(candidates) == 1:
            match = next(iter(candidates.values()))
    coords = place.findtext('.//k:coordinates', '', NS).strip().split(',')
    if len(coords) < 2:
        raise ValueError('Missing coordinates: ' + name)
    lon, lat = map(float, coords[:2])
    if not (37.6 < lat < 37.9 and -122.6 < lon < -122.3):
        raise ValueError('Coordinate outside San Francisco: ' + name)
    style = place.findtext('k:styleUrl', '', NS).split('-')[2]
    entry = dict(match) if match else {'name': name, 'neighborhood': 'Map-only entries', 'rating': COLORS[style], 'steps': '', 'photos': photos, 'photoNote': ''}
    if match:
        used.add(match['row'])
    entry.update({'id': hashlib.sha1((name + str(lat) + str(lon)).encode()).hexdigest()[:12], 'lat': lat, 'lng': lon, 'mapName': name, 'needsVerification': style == '000000'})
    entry['photos'] = list(dict.fromkeys(entry['photos'] + photos))
    entries.append(entry)
for row in rows:
    if row['row'] not in used:
        entries.append(dict(row, id='sheet-' + str(row['row']), lat=None, lng=None, mapName='', needsVerification=False))
entries.sort(key=lambda e: (-e['rating'], e['neighborhood'], e['name']))

cache_path = ROOT / 'data/photo-previews.json'
cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
featured = [e for e in entries if e['rating'] == 5 and e['photos']]
def preview(entry):
    url = entry['photos'][0]
    if url in cache:
        return url, cache[url]
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=20) as response:
            page = response.read(3000000).decode()
        match = re.search(r'<meta property="og:image" content="([^"]+)"', page)
        if match:
            return url, html.unescape(match.group(1))
    except Exception as error:
        print('Photo preview unavailable:', url, str(error))
    return url, None
with ThreadPoolExecutor(max_workers=8) as executor:
    for url, image in executor.map(preview, featured):
        if image:
            cache[url] = image
cache_path.write_text(json.dumps(cache, indent=2))
photo_dir = ROOT / 'public/photos'
photo_dir.mkdir(parents=True, exist_ok=True)
def download_preview(item):
    album, url = item
    filename = hashlib.sha1(album.encode()).hexdigest()[:16] + '.jpg'
    path = photo_dir / filename
    if not path.exists():
        try:
            with urllib.request.urlopen(url, timeout=25) as response:
                if response.headers.get_content_type() != 'image/jpeg':
                    raise ValueError('Preview is not a JPEG')
                content = response.read(3000001)
                if len(content) > 3000000:
                    raise ValueError('Preview exceeds 3 MB')
                path.write_bytes(content)
        except Exception as error:
            print('Preview download failed:', album, str(error))
            return album, None
    return album, '/photos/' + filename
with ThreadPoolExecutor(max_workers=8) as executor:
    local_photos = dict(executor.map(download_preview, cache.items()))
for entry in entries:
    entry['image'] = next((local_photos[url] for url in entry['photos'] if local_photos.get(url)), None)
output = {'importedAt': '2026-09-14', 'mapUpdatedAt': '2026-07-26', 'stairs': entries}
(ROOT / 'src/stairs.json').write_text(json.dumps(output, ensure_ascii=False))
print(json.dumps({'entries': len(entries), 'mapped': sum(e['lat'] is not None for e in entries), 'sheetOnly': sum(e['lat'] is None for e in entries), 'previews': sum(bool(e['image']) for e in entries), 'ratings': dict(Counter(e['rating'] for e in entries))}))
