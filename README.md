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

Wrangler uses your existing Cloudflare authentication. The Worker is named `sf-stairs-map`. No API keys, database, or server-side runtime are required. Map tiles use OpenStreetMap with visible attribution. Tiles load directly in the browser; the site does not prefetch or proxy them.

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
