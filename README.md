# SF Stairs

An interactive field guide to San Francisco stairways, hosted with Cloudflare Workers Static Assets. Built with TypeScript, Vite, and Leaflet.

## Development

```sh
npm ci
npm run dev
npm run build
npx playwright install chromium
npm test
```

## Deployment

```sh
npm run deploy
```

Wrangler uses your existing Cloudflare authentication. The Worker is named `sf-stairs-map`. It serves static assets only: there is no API route, no key to configure, and no server-side runtime. Map tiles use OpenStreetMap with visible attribution. Tiles load directly in the browser; the site does not prefetch or proxy them.

## Stairway measurements

Each stairway's elevation gain and step count are measured once, ahead of time, and
committed to `src/stairway-metrics.json`. The browser imports that file with the rest of
the bundle, so opening a stairway makes no network request and has no response to parse.

```sh
python3 scripts/build-stairway-metrics.py
```

The script matches every mapped stairway to the real `highway=steps` geometry in
OpenStreetMap, bridging flights that are drawn as separate ways within 25 m of each other
so that a staircase like the 16th Avenue Tiled Steps — mapped as a dozen unconnected
flights — is measured whole. It then samples the USGS 3DEP elevation service along that
geometry, which answers from a 1 metre lidar surface over San Francisco.

Step counts come from the best source available, and the detail panel says which one:

| Source | Entries | Shown as |
| --- | --- | --- |
| Source index | 32 | `120 steps` |
| Counted by OpenStreetMap surveyors | 220 | `120 steps` |
| Estimated from the measured rise | 593 | `~120 steps` |

Estimates divide the measured rise by a riser height calibrated against the 133 staircases
OSM has already counted: 5.7 in for climbs under 10 ft and 6.73 in above. They land within
about 16% of a surveyed count, and the panel labels them with a `~`. Stairways with no
matching staircase within 70 m are reported as not measured rather than guessed at, as are
the three whose counted and measured geometry disagree too much to be the same structure.

Downloads are cached under `data/cache/`, so a re-run costs nothing and works offline.
Pass `--refresh-osm` to pull fresh geometry, or `--google-key KEY` to sample the Google
Elevation API instead of USGS.

## Data and attribution

The source collection belongs to Alexandra Kenin / Urban Hiker SF:

- [Spreadsheet](https://docs.google.com/spreadsheets/d/1OHwJvr7IrhPZ4nCelzOnPeDp3Rl567uNnytP0bF8gtE/edit?gid=0)
- [Companion map](https://www.google.com/maps/d/viewer?mid=1F4TY3dl4yiG6VBqigpnrFvhsbK_FYcsW)
- [Urban Hiker SF](https://www.urbanhikersf.com)

Based on the index of *Stairway Walks of San Francisco* by Mary Burk and Adah Bakalinsky. The site includes contact and social links, source links, a paraphrased rating legend, and original photo album links. Photo previews are bundled in `public/photos/`; original Google Photos album links, attribution, and additional photographer credits are preserved. External albums and map tiles require a network connection and can become unavailable.

The September 14, 2026 snapshot contains 1,099 map points and 24 additional spreadsheet entries without matched coordinates. Records match by unique normalized description or unique shared photo URL. Spreadsheet ratings take precedence for matched records. Unmatched map points keep their original rating. No coordinates are estimated. Similar unmatched records may represent the same physical stairway. Black map markers retain their verification status. Beige spreadsheet formatting is explained in the legend but is not reproduced because CSV does not retain cell formatting.

Source snapshots are in `data/`. To refresh, replace `data/stairs.csv` and `data/stairs.kml` with new exports, update snapshot dates in the importer and attribution dialog, and run:

```sh
npm run import:data
npm run build
npm test
```

The importer uses Python's standard library downloads preview images and caches Google Photos preview URLs in `data/photo-previews.json`. Five-star entries receive image previews; other entries retain their original album links. The import checks coordinate bounds and preserves unmapped spreadsheet entries. Source data is bundled during the build; the live site does not automatically follow spreadsheet edits.
