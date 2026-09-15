import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './route-planner.css';
import './multi-neighborhood.css';
import './verification-report.css';
const { default: dataset } = await import('./stairs.json');

type Stair = (typeof dataset.stairs)[number];
type RouteStop = Stair & { lat: number; lng: number };
const stairs: Stair[] = dataset.stairs;
const colors = ['#242923', '#0288d1', '#558b2f', '#d2ad00', '#f57c00', '#e65100'];
const labels = ['Needs verification', 'Simple & functional', 'Neighborhood character', 'Hidden gems', 'Something special', 'The Scheherazade category'];
const legendDescriptions = [
  'Black markers need verification or an addition to the source spreadsheet.',
  'The most ordinary stairways in the index.',
  'Part of the neighborhood’s history and everyday life. The setting or view may be the main attraction.',
  'Lesser-known stairways in especially attractive surroundings.',
  'Impressive design or an outstanding feature, with only minor shortcomings.',
  'Stairways that surprise, spark the imagination, and delight the senses. Elegant or rustic, short or long.'
];
const sourceSheet = 'https://docs.google.com/spreadsheets/d/1OHwJvr7IrhPZ4nCelzOnPeDp3Rl567uNnytP0bF8gtE/edit?gid=0';
const sourceMap = 'https://www.google.com/maps/d/viewer?mid=1F4TY3dl4yiG6VBqigpnrFvhsbK_FYcsW';
const icon = (name: string, size = 20) => {
  const paths: Record<string, string> = {
    stairs: '<path d="M3 21h6v-6h6V9h6V3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    shuffle: '<path d="m3 5 5 0 8 14h5m-5-4 5 4-5 4M3 19h5L16 5h5m-5-4 5 4-5 4"/>',
    route: '<path d="M4 18c3-1 3-11 7-11s3 10 7 9 2-6 3-8"/><circle cx="4" cy="18" r="2"/><circle cx="21" cy="8" r="2"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    elevation: '<path d="M3 19 9 9l4 6 3-4 5 8"/><path d="M3 21h18"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.stairs}</svg>`;
};
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}
const neighborhoods = [...new Set(stairs.map(stair => stair.neighborhood))].sort();
const featuredStairs = stairs.filter(stair => stair.image).sort(() => Math.random() - .5).slice(0, 3);
let featuredIndex = 0;
let featured = featuredStairs[featuredIndex];
let rating = 'all';
let query = '';
const selectedNeighborhoods = new Set<string>();
let photosOnly = false;
let visible: Stair[] = [];
let selected: Stair | undefined;
let pageSize = 45;
let nearbyOrigin: L.LatLng | undefined;
let userMarker: L.CircleMarker | undefined;
let routeStops: RouteStop[] = [];
let routeArea = 'all';
let routePreference = 'best';

el('#app').innerHTML = `
  <header class="header">
    <a class="brand" href="/" aria-label="SF Stairs home"><span class="brand-icon">${icon('stairs', 28)}</span><span>sf stairs<span class="brand-dot">.</span></span></a>
    <div class="header-note">A FIELD GUIDE TO THE CITY’S STAIRWAYS</div>
    <button id="about-button" class="text-button">The story behind the steps ${icon('arrow', 16)}</button>
  </header>
  <main>
    <section class="intro">
      <div class="intro-copy"><div class="eyebrow"><span></span> SAN FRANCISCO, ONE STEP AT A TIME</div>
        <h1>Take the <span>scenic way.</span></h1>
        <p>A thousand little ways to fall in love with this city.<br>Find hidden stairways, neighborhood gems, and a new view.</p>
        <div class="intro-bottom"><span><strong>${stairs.filter(s => s.lat !== null).length.toLocaleString()}</strong> mapped stairways</span><span class="divider"></span><span>Inspired by <button id="credit-button">Urban Hiker SF ↗</button></span></div><button id="near-me" class="near-me">${icon('locate', 18)}<span><strong>Stairs near me</strong><small>Use my location</small></span><span class="near-me-arrow">${icon('arrow', 16)}</span></button>
      </div>
      <button id="featured" class="featured" data-featured-id="${featured.id}" aria-label="Explore ${escape(featured.name)}"><img src="${escape(featured.image!)}" alt="${escape(featured.name)}" fetchpriority="high"><span class="featured-shade"></span><span class="photo-stamp">A DIFFERENT KIND OF SHORTCUT</span><span class="featured-caption"><span>${escape(featured.name.split('/')[0])}<small>${escape(featured.neighborhood)} · ★ ${featured.rating} rated</small></span><span class="circle-arrow" title="Show another featured stairway">${icon('arrow')}</span></span></button>
    </section>
    <section class="explorer" aria-label="Explore stairways">
      <div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search a stairway, street, or neighborhood" aria-label="Search stairways"></label><div class="toolbar-right"><label class="select-wrap">${icon('pin', 17)}<select id="neighborhood" aria-label="Neighborhood"><option value="">All neighborhoods</option>${neighborhoods.map(n => `<option>${escape(n)}</option>`).join('')}</select></label><button id="surprise" class="surprise">${icon('shuffle', 17)} Surprise me</button></div></div>
      <div class="filter-bar"><span class="filter-label">EXPLORE BY RATING</span><div class="rating-filters"><button class="chip active" data-rating="all" aria-pressed="true">All stairs</button>${[5,4,3,2,1].map(r => `<button class="chip" data-rating="${r}" aria-pressed="false"><span class="dot" style="--dot:${colors[r]}"></span>${r}<span class="chip-extra"> · ${['','','Local favorites','Hidden gems','Impressive','Extraordinary'][r] || 'Everyday'}</span></button>`).join('')}</div><label class="photo-filter" title="Filter results to stairways with visible photo previews"><input type="checkbox" id="photos-only"> Only show stairways with photo previews</label></div>
      <div class="explorer-body"><aside class="results-panel"><div class="results-heading"><div><h2>Your next discovery</h2><p id="result-count" aria-live="polite"></p></div><button id="reset" class="reset">Reset</button></div><div id="results" class="results"></div></aside><div class="map-wrap"><div id="map" aria-label="Interactive San Francisco stairway map"></div><div class="map-badge"><span class="live-dot"></span> THE CITY IS BETTER ON FOOT</div><div class="map-actions"><button id="locate" aria-label="Find my location" title="Find my location">${icon('locate')}</button><button id="fit" aria-label="Fit all filtered stairways" title="Fit filtered stairways">${icon('pin')}</button></div><details class="map-legend" open><summary>Map legend <span>⌃</span></summary><div>${[5,4,3,2,1,0].map(r=>`<div><span class="dot" style="--dot:${colors[r]}"></span><b>${r || '?'}</b> ${labels[r]}</div>`).join('')}<button id="legend-button">What do the ratings mean? ↗</button></div></details><div id="detail" class="detail" hidden></div><p id="map-status" role="status" hidden></p></div></div>
    </section>
    <section class="credit-strip"><span class="credit-mark">${icon('stairs',28)}</span><p>A love letter to the people who take the long way.<br><span>Built on the stairway map by <button id="bottom-credit">Alexandra Kenin / Urban Hiker SF</button> and the work of Mary Burk & Adah Bakalinsky.</span></p><a href="${sourceSheet}" target="_blank" rel="noopener noreferrer">Explore the original collection ${icon('external',15)}</a></section>
  </main>
  <footer><span>SAN FRANCISCO, CALIFORNIA</span><span>made w/ <span class="heart">&lt;3</span> in sf</span><span>GO OUTSIDE. LOOK UP.</span></footer>
  <dialog id="about"><button class="dialog-close" aria-label="Close about dialog">${icon('close')}</button><div class="eyebrow">THE PEOPLE BEHIND THE PATHS</div><h2>A city discovered<br>one stairway at a time.</h2><p>This independent project pays homage to <strong>Alexandra Kenin and Urban Hiker SF</strong>, whose public stairway map and photo collection make these discoveries possible.</p><p>The collection is based on the index of <em>Stairway Walks of San Francisco</em> by <strong>Mary Burk and Adah Bakalinsky</strong>, with additional stairways documented by Urban Hiker SF.</p><div class="source-links"><a href="${sourceSheet}" target="_blank" rel="noopener noreferrer">Original spreadsheet ↗</a><a href="${sourceMap}" target="_blank" rel="noopener noreferrer">Original map ↗</a><a href="https://www.urbanhikersf.com" target="_blank" rel="noopener noreferrer">Urban Hiker SF ↗</a><a href="https://www.buymeacoffee.com/urbanhikersf" target="_blank" rel="noopener noreferrer">Buy Alexandra a matcha ↗</a></div><h3>Keep in touch with Urban Hiker SF</h3><a href="mailto:info@urbanhikersf.com">info@urbanhikersf.com</a><p><a href="https://www.instagram.com/urbanhikersf/" target="_blank" rel="noopener noreferrer">Instagram: @urbanhikersf</a> · <a href="https://twitter.com/urbanhikersf" target="_blank" rel="noopener noreferrer">Twitter: @urbanhikersf</a><br><a href="https://www.facebook.com/urbanhikersf" target="_blank" rel="noopener noreferrer">Facebook: facebook.com/urbanhikersf</a></p><h3>The original rating legend</h3><p class="muted">Ratings describe a stairway’s character, not walking difficulty. Explanations below paraphrase the source legend.</p><div class="full-legend">${[5,4,3,2,1,0].map(r=>`<div><span class="legend-number" style="background:${colors[r]}">${r || '?'}</span><p><strong>${labels[r]}</strong><br>${legendDescriptions[r]}</p></div>`).join('')}</div><p class="muted">Beige rows in the original spreadsheet identify additions beyond the book’s index. This site does not reproduce that row formatting.</p><h3>About this collection</h3><p class="muted">Imported September 14, 2026; the source map says it was last updated July 26, 2026. Spreadsheet ratings take precedence for matched entries. Map-only entries retain their map rating. Entries without matched coordinates stay in the list. Locations and access may change; follow posted signs.</p><p class="muted">Photo previews and album links come from the source collection. Photo credits remain with their original creators; additional credits appear with individual entries. This site is not affiliated with Urban Hiker SF.</p></dialog>`;

const routeAreaOptions = `<option value="all">All of San Francisco</option><optgroup label="Broad areas"><option value="area:north">North & waterfront</option><option value="area:central">Central city</option><option value="area:west">Westside</option><option value="area:south">South & southeast</option></optgroup><optgroup label="Neighborhoods">${neighborhoods.map(name => `<option value="neighborhood:${escape(name)}">${escape(name)}</option>`).join('')}</optgroup>`;
el('#neighborhood').parentElement!.outerHTML = `<details id="neighborhood-picker" class="neighborhood-picker"><summary>${icon('pin', 17)}<span id="neighborhood-label">All neighborhoods</span></summary><div class="neighborhood-menu"><div><span>Choose neighborhoods</span><button id="clear-neighborhoods" type="button">Clear</button></div>${neighborhoods.map(name => `<label><input type="checkbox" value="${escape(name)}">${escape(name)}</label>`).join('')}</div></details>`;
el('.toolbar-right').insertAdjacentHTML('beforeend', `<button id="route-toggle" class="route-toggle" aria-expanded="false">${icon('route', 17)} Plan a stair route</button>`);
el('.map-wrap').insertAdjacentHTML('beforeend', `<section id="route-planner" class="route-planner" hidden><button id="route-close" class="route-close" aria-label="Close route planner">${icon('close', 17)}</button><div class="eyebrow"><span></span> Walk planner</div><h2>A good day for stairs.</h2><p>Choose a neighborhood or a broad area, then make a compact loop.</p><div class="route-controls"><label>Route area <select id="route-area">${routeAreaOptions}</select></label><label>Stairways <select id="route-preference"><option value="best">Best rated when available</option><option value="nearby">Closest mix of ratings</option></select></label><label>Stops <select id="route-count">${[3,4,5,6,7,8].map(count => `<option value="${count}"${count === 4 ? ' selected' : ''}>${count} stairways</option>`).join('')}</select></label></div><button id="route-generate" class="route-generate">${icon('shuffle', 16)} Generate a route</button><p id="route-note" class="route-note"></p><div id="route-output" hidden><p id="route-distance"></p><ol id="route-stops"></ol><a id="route-directions" target="_blank" rel="noopener noreferrer">Continue in Google Maps ${icon('external', 15)}</a></div></section>`);

el('#app').insertAdjacentHTML('beforeend', '<dialog id="verification-report"><form id="verification-form"><button type="button" id="verification-close">×</button><p class="eyebrow">COMMUNITY UPDATE</p><h2>Help verify this stairway</h2><p>Share what you found. Reports are reviewed before this map changes.</p><label>What needs updating?<select name="type"><option value="location">Location or route</option><option value="access">Access or closure</option><option value="duplicate">Duplicate listing</option><option value="photo">Photo or link</option><option value="other">Something else</option></select></label><label>What did you find?<textarea name="details" required maxlength="1500"></textarea></label><label>Email (optional)<input name="contact" type="email"></label><button>Send report</button><p id="verification-status" role="status"></p></form></dialog>');
const map = L.map('map', {zoomControl: false, preferCanvas: true}).setView([37.759, -122.445], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).on('tileerror', () => status('Map tiles could not load. You can still browse stairways in the list.')).addTo(map);
L.control.zoom({position: 'topright'}).addTo(map);
const markers = L.layerGroup().addTo(map);
const routeLines = L.layerGroup().addTo(map);
let selectedMarker: L.CircleMarker | undefined;
function routeCandidates(): RouteStop[] {
  return stairs.filter((stair): stair is RouteStop => stair.lat !== null && stair.lng !== null).filter(stair => routeArea === 'all' || routeArea.startsWith('neighborhood:') ? stair.neighborhood === routeArea.slice(13) || routeArea === 'all' : routeArea === 'area:west' ? stair.lng <= -122.47 : routeArea === 'area:north' ? stair.lng > -122.47 && stair.lat >= 37.785 : routeArea === 'area:south' ? stair.lng > -122.47 && stair.lat < 37.745 : stair.lng > -122.47 && stair.lat >= 37.745 && stair.lat < 37.785);
}
function routeUrl(stops: RouteStop[]) { const params = new URLSearchParams({api:'1',origin:`${stops[0].lat},${stops[0].lng}`,destination:`${stops[0].lat},${stops[0].lng}`,travelmode:'walking'}); params.set('waypoints', stops.slice(1).map(stop => `${stop.lat},${stop.lng}`).join('|')); return `https://www.google.com/maps/dir/?${params}`; }
function distanceMiles(a: RouteStop, b: RouteStop) { const r=Math.PI/180, lat=(b.lat-a.lat)*r, lng=(b.lng-a.lng)*r, value=Math.sin(lat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(lng/2)**2; return 3958.8*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value)); }
function generateRoute() {
  const candidates=routeCandidates(), count=Math.min(Number(el<HTMLSelectElement>('#route-count').value), candidates.length);
  if(candidates.length<2){el('#route-note').textContent='Choose another route area.';return;}
  const best=routePreference==='best' ? candidates.filter(stop=>stop.rating===Math.max(...candidates.map(item=>item.rating))) : candidates;
  const start=best[Math.floor(Math.random()*best.length)], remaining=candidates.filter(stop=>stop.id!==start.id); routeStops=[start];
  while(routeStops.length<count&&remaining.length){const top=routePreference==='best'?remaining.filter(stop=>stop.rating===Math.max(...remaining.map(item=>item.rating))):remaining;const current=routeStops.at(-1)!;const choice=top.map(stop=>({stop,distance:distanceMiles(current,stop)})).sort((a,b)=>a.distance-b.distance)[Math.floor(Math.random()*Math.min(3,top.length))].stop;routeStops.push(choice);remaining.splice(remaining.findIndex(stop=>stop.id===choice.id),1);}
  routeLines.clearLayers(); L.polyline([...routeStops,routeStops[0]].map(stop=>[stop.lat,stop.lng]),{color:'#ce4b2d',weight:4,dashArray:'7 7'}).addTo(routeLines); el('#route-distance').textContent=`${routeStops.length} stairways · best rated first`; el('#route-stops').innerHTML=routeStops.map(stop=>`<li>${escape(stop.name)} · ★ ${stop.rating}</li>`).join(''); el<HTMLAnchorElement>('#route-directions').href=routeUrl(routeStops); el('#route-output').hidden=false; map.fitBounds(L.latLngBounds(routeStops.map(stop=>[stop.lat,stop.lng])),{padding:[54,54],maxZoom:15});
}
function status(message: string) {el('#map-status').textContent = message;el('#map-status').hidden = false;}
function hideDetail() {el('#detail').hidden = true; selected = undefined;if(selectedMarker)map.removeLayer(selectedMarker); history.replaceState(null, '', location.pathname + location.search);}
function selectStair(stair: Stair) {
  selected = stair;
  history.replaceState(null, '', `#${stair.id}`);
  const detail = el('#detail');
  detail.hidden = false;
  detail.innerHTML = `<button class="detail-close" aria-label="Close stairway details">${icon('close')}</button>${stair.image ? `<a class="detail-image-link" href="${escape(stair.photos[0])}" target="_blank" rel="noopener noreferrer"><img class="detail-image" src="${escape(stair.image)}" alt="${escape(stair.name)}"><span>Photos from the Urban Hiker SF collection ↗</span></a>` : ''}<div class="detail-content"><div class="eyebrow">${escape(stair.neighborhood)}</div><h2>${escape(stair.name)}</h2><div class="detail-tags"><span class="rating-tag" style="--dot:${colors[stair.rating]}">${stair.rating ? '★ ' + stair.rating + ' / 5' : '? Unrated'}</span><span>${labels[stair.rating]}</span></div><section class="entry-measurements"><div><span>Step count</span><strong id="step-count">${stair.steps ? `${escape(stair.steps)} steps` : 'Estimating…'}</strong><small id="step-note">${stair.steps ? 'From the source index' : 'Estimated from Google elevation'}</small></div>${stair.lat !== null ? `<div id="elevation-card"><span>Elevation gain</span><strong id="elevation-value">Calculating…</strong><button id="elevation-button">${icon('elevation', 15)} Calculate from Google Maps</button><small id="elevation-note">Using the mapped point and a Google Maps endpoint or local terrain range.</small></div>` : '<div><span>Elevation gain</span><strong>Not mapped</strong><small>This entry has no coordinates.</small></div>'}</section>${stair.needsVerification ? '<p class="notice">This location needs verification in the original map.</p>' : ''}${stair.lat === null ? '<p class="notice">Listed in the spreadsheet; no matched map coordinates.</p>' : ''}<div class="detail-links">${stair.photos.map((url, i)=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${icon('camera',16)} ${i ? 'More photos' : 'View original photos'} ↗</a>`).join('')}${stair.lat !== null ? `<a class="directions" href="https://www.google.com/maps/dir/?api=1&destination=${stair.lat},${stair.lng}&travelmode=walking" target="_blank" rel="noopener noreferrer">Walking directions ${icon('arrow',16)}</a>` : ''}</div>${!stair.photos.length ? '<p class="muted">No photos linked in the source collection yet.</p>' : ''}${/photo by/i.test(stair.photoNote) ? `<p class="muted">${escape(stair.photoNote.replace(/https:\/\/\S+/g, '').trim())}</p>` : ''}${'row' in stair ? `<a class="source-row" href="${sourceSheet}&range=B${stair.row}:F${stair.row}" target="_blank" rel="noopener noreferrer">View spreadsheet entry ↗</a>` : `<a class="source-row" href="${sourceMap}" target="_blank" rel="noopener noreferrer">View original map ↗</a>`}</div>`;
  detail.querySelector('button')!.addEventListener('click', hideDetail);
  if (stair.needsVerification) {
    detail.querySelector('.detail-content')!.insertAdjacentHTML('beforeend', '<button class="report-verification">Help verify this stairway</button>');
    detail.querySelector<HTMLButtonElement>('.report-verification')!.addEventListener('click', () => {
      el<HTMLDialogElement>('#verification-report').dataset.stairId = stair.id;
      el<HTMLDialogElement>('#verification-report').showModal();
    });
  }
  if (stair.lat !== null && stair.lng !== null) void calculateElevation(stair, detail);
  handleImages(detail);
  if(selectedMarker) map.removeLayer(selectedMarker);
  if(stair.lat !== null && stair.lng !== null) {
    map.setView([stair.lat, stair.lng], 16, {animate: false});
    selectedMarker = L.circleMarker([stair.lat, stair.lng], {radius: 13, color: '#292e28', weight: 3, fillColor: colors[stair.rating], fillOpacity: 1}).addTo(map);
    const offset = window.innerWidth > 760 ? 160 : 0;
    map.panBy([-offset, 0], {animate: false});
  }
  if(window.innerWidth <= 760) el('.map-wrap').scrollIntoView({behavior: 'smooth', block: 'start'});
}
async function calculateElevation(stair: Stair, detail: HTMLElement) {
  const button = detail.querySelector<HTMLButtonElement>('#elevation-button');
  const value = detail.querySelector<HTMLElement>('#elevation-value');
  const note = detail.querySelector<HTMLElement>('#elevation-note');
  if (!button || !value || !note || stair.lat === null || stair.lng === null) return;
  button.disabled = true;
  button.hidden = true;
  value.textContent = 'Calculating…';
  note.textContent = 'Looking up an endpoint and sampling the elevation path.';
  const params = new URLSearchParams({ version: '3', lat: String(stair.lat), lng: String(stair.lng), description: stair.name.slice(0, 500) });
  try {
    const response = await fetch(`/api/elevation?${params}`);
    const result = await response.json() as { available?: boolean; gainFeet?: number; descentFeet?: number; verticalFeet?: number; startFeet?: number; endFeet?: number; endpoint?: string; estimatedSteps?: number; method?: 'inferred-path' | 'local-range'; reason?: string };
    if (!response.ok || !result.available) throw new Error(result.reason || 'Elevation data is unavailable for this entry.');
    value.textContent = result.method === 'inferred-path' ? (result.gainFeet! >= result.descentFeet! ? `~${result.gainFeet} ft uphill` : `~${result.descentFeet} ft downhill`) : `~${result.gainFeet} ft change`;
    note.textContent = result.method === 'inferred-path' ? `Estimated from ${result.startFeet} ft to ${result.endFeet} ft toward ${result.endpoint}.` : 'Estimated from Google elevation samples within 45 m of the mapped location.';
    if (!stair.steps) {
      const stepCount = detail.querySelector<HTMLElement>('#step-count');
      const stepNote = detail.querySelector<HTMLElement>('#step-note');
      if (stepCount && stepNote) {
        stepCount.textContent = `~${result.estimatedSteps} steps`;
        stepNote.textContent = 'Estimated from Google elevation using a 7 in riser.';
      }
    }
  } catch (error) {
    value.textContent = 'No estimate available';
    note.textContent = error instanceof Error ? error.message : 'Elevation data is unavailable for this entry.';
  } finally {
    button.hidden = true;
  }
}
function handleImages(parent: HTMLElement) {
  parent.querySelectorAll<HTMLImageElement>('img').forEach(img => img.addEventListener('error', () => {img.hidden = true; img.parentElement?.classList.add('image-unavailable');}, {once: true}));
}
function renderFeatured() {
  const button = el<HTMLButtonElement>('#featured');
  button.dataset.featuredId = featured.id;
  button.setAttribute('aria-label', `Explore ${featured.name}`);
  button.innerHTML = `<img src="${escape(featured.image!)}" alt="${escape(featured.name)}"><span class="featured-shade"></span><span class="photo-stamp">A DIFFERENT KIND OF SHORTCUT</span><span class="featured-caption"><span>${escape(featured.name.split('/')[0])}<small>${escape(featured.neighborhood)} · ★ ${featured.rating} rated</small></span><span class="circle-arrow" title="Show another featured stairway">${icon('arrow')}</span></span>`;
  handleImages(button);
}
function distanceFromNearbyOrigin(stair: Stair) {
  return nearbyOrigin && stair.lat !== null && stair.lng !== null ? nearbyOrigin.distanceTo([stair.lat, stair.lng]) : undefined;
}
function formatNearbyDistance(meters: number) {
  return meters < 1609 ? `${Math.round(meters / 10) * 10} m away` : `${(meters / 1609.34).toFixed(1)} mi away`;
}
function renderList() {
  const results = el('#results');
  results.innerHTML = visible.length ? visible.slice(0, pageSize).map(stair => { const distance = distanceFromNearbyOrigin(stair); return `<button class="stair-card" data-id="${stair.id}"><span class="thumbnail ${stair.image ? '' : 'no-photo'}" style="--tint:${colors[stair.rating]}">${stair.image ? `<img src="${escape(stair.image)}" alt="" loading="lazy">` : icon('stairs', 29)}<span class="small-rating" style="background:${colors[stair.rating]}">${stair.rating || '?'}</span></span><span class="card-copy"><span class="neighborhood">${escape(stair.neighborhood)}</span><span class="stair-name">${escape(stair.name)}</span><span class="card-meta">${distance === undefined ? (stair.steps ? escape(stair.steps) + ' steps' : labels[stair.rating]) : `<b class="nearby-distance">${formatNearbyDistance(distance)}</b>`}${stair.photos.length ? ` <span>· ${icon('camera',12)}</span>` : ''}${stair.lat === null ? ' · Not mapped' : ''}</span></span><span class="card-arrow">↗</span></button>`; }).join('') + (visible.length > pageSize ? '<button id="load-more">Show more stairways ↓</button>' : '') : '<div class="empty"><h3>No stairs found.</h3><p>Try another street, neighborhood, or rating.</p><button id="empty-reset">Clear filters</button></div>';
  results.querySelectorAll<HTMLButtonElement>('[data-id]').forEach(button => button.addEventListener('click', () => selectStair(stairs.find(s => s.id === button.dataset.id)!)));
  results.querySelector('#load-more')?.addEventListener('click', () => {pageSize += 45; renderList();});
  results.querySelector('#empty-reset')?.addEventListener('click', reset);
  handleImages(results);
}
function fit() {
  const points = visible.filter(s=>s.lat!==null && s.lng!==null).map(s=>L.latLng(s.lat!, s.lng!));
  if(points.length)map.fitBounds(L.latLngBounds(points), {padding: [45,45], maxZoom: 16, animate: false});
  else status('These results have no matched map coordinates.');
}
function render(fitMap = false) {
  el('#map-status').hidden = true;
  visible = stairs.filter(stair => (rating === 'all' || stair.rating === Number(rating)) && (!selectedNeighborhoods.size || selectedNeighborhoods.has(stair.neighborhood)) && (!photosOnly || Boolean(stair.image)) && `${stair.name} ${stair.neighborhood}`.toLowerCase().includes(query.toLowerCase().trim()));
  if (nearbyOrigin) visible.sort((a, b) => (distanceFromNearbyOrigin(a) ?? Infinity) - (distanceFromNearbyOrigin(b) ?? Infinity));
  pageSize = 45;
  const mapped = visible.filter(s=>s.lat!==null).length;
  el('#result-count').textContent = nearbyOrigin ? `${visible.length.toLocaleString()} stairways · sorted by distance` : `${visible.length.toLocaleString()} stairways · ${mapped.toLocaleString()} on the map`;
  el('.results-heading h2').textContent = nearbyOrigin ? 'Stairs near you' : 'Your next discovery';
  el<HTMLButtonElement>('#surprise').disabled = !visible.length;
  markers.clearLayers();
  for(const stair of visible) {
    if(stair.lat === null || stair.lng === null)continue;
    const color = stair.needsVerification ? colors[0] : colors[stair.rating];
    L.circleMarker([stair.lat, stair.lng], {radius: stair.rating === 5 ? 6.5 : 4.5, color: '#fff', weight: 1.3, fillColor: color, fillOpacity: .94}).bindTooltip(escape(stair.name), {direction: 'top'}).on('click', () => selectStair(stair)).addTo(markers);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach(button => {button.classList.toggle('active', button.dataset.rating === rating);button.setAttribute('aria-pressed', String(button.dataset.rating === rating));});
  renderList();
  if(selected && !visible.includes(selected)) hideDetail();
  if(fitMap) fit();
}
function reset() {
  rating = 'all'; query = ''; selectedNeighborhoods.clear(); photosOnly = false; nearbyOrigin = undefined;
  if (userMarker) { map.removeLayer(userMarker); userMarker = undefined; }
  el('#near-me').innerHTML = `${icon('locate', 18)}<span><strong>Stairs near me</strong><small>Use my location</small></span><span class="near-me-arrow">${icon('arrow', 16)}</span>`;
  el<HTMLInputElement>('#search').value = '';document.querySelectorAll<HTMLInputElement>('#neighborhood-picker input').forEach(input => input.checked = false);el('#neighborhood-label').textContent = 'All neighborhoods';el<HTMLInputElement>('#photos-only').checked = false;
  hideDetail(); render(); map.setView([37.759, -122.445], 12);
}
el<HTMLInputElement>('#search').addEventListener('input', event => {query = (event.target as HTMLInputElement).value;render(true);});
document.querySelectorAll<HTMLInputElement>('#neighborhood-picker input').forEach(input => input.addEventListener('change', () => { if(input.checked) selectedNeighborhoods.add(input.value);else selectedNeighborhoods.delete(input.value);el('#neighborhood-label').textContent=selectedNeighborhoods.size===1?[...selectedNeighborhoods][0]:selectedNeighborhoods.size?`${selectedNeighborhoods.size} neighborhoods`:'All neighborhoods';render(true); }));
el('#clear-neighborhoods').addEventListener('click', () => {selectedNeighborhoods.clear();document.querySelectorAll<HTMLInputElement>('#neighborhood-picker input').forEach(input=>input.checked=false);el('#neighborhood-label').textContent='All neighborhoods';render(true);});
el<HTMLInputElement>('#photos-only').addEventListener('change', event => {photosOnly = (event.target as HTMLInputElement).checked;render();});
document.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach(button => button.addEventListener('click', () => {rating = button.dataset.rating!;render();}));
el('#reset').addEventListener('click', reset);
el('#fit').addEventListener('click', fit);
el('#surprise').addEventListener('click', () => {if(visible.length)selectStair(visible[Math.floor(Math.random() * visible.length)]);});
el('#route-toggle').addEventListener('click', () => { const planner=el<HTMLElement>('#route-planner'); planner.hidden=!planner.hidden; });
el('#route-close').addEventListener('click', () => el<HTMLElement>('#route-planner').hidden=true);
el('#route-generate').addEventListener('click', generateRoute);
el<HTMLSelectElement>('#route-area').addEventListener('change', event => {routeArea=(event.target as HTMLSelectElement).value;el('#route-output').hidden=true;});
el<HTMLSelectElement>('#route-preference').addEventListener('change', event => {routePreference=(event.target as HTMLSelectElement).value;el('#route-output').hidden=true;});
el<HTMLButtonElement>('#near-me').addEventListener('click', () => {
  const button = el<HTMLButtonElement>('#near-me');
  if (!navigator.geolocation) { status('Your browser does not support location. Search a neighborhood instead.'); return; }
  button.disabled = true;
  button.innerHTML = `${icon('locate', 18)}<span><strong>Finding nearby stairs…</strong><small>Waiting for your location</small></span>`;
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    if (latitude < 37.6 || latitude > 37.9 || longitude < -122.6 || longitude > -122.3) { status('You’re outside San Francisco. Pick a neighborhood to plan your next walk.'); button.disabled = false; button.innerHTML = `${icon('locate', 18)}<span><strong>Stairs near me</strong><small>Use my location</small></span><span class="near-me-arrow">${icon('arrow', 16)}</span>`; return; }
    nearbyOrigin = L.latLng(latitude, longitude);
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker(nearbyOrigin, { radius: 8, color: 'white', weight: 3, fillColor: '#2364d2', fillOpacity: 1 }).bindTooltip('You are here').addTo(map);
    button.disabled = false;
    button.innerHTML = `${icon('locate', 18)}<span><strong>Showing stairs near you</strong><small>Sorted by distance</small></span><span class="near-me-arrow">${icon('arrow', 16)}</span>`;
    render(); map.setView(nearbyOrigin, 14); status('Stairways are sorted by straight-line distance from your location.');
  }, () => { button.disabled = false; button.innerHTML = `${icon('locate', 18)}<span><strong>Stairs near me</strong><small>Allow location access</small></span><span class="near-me-arrow">${icon('arrow', 16)}</span>`; status('Location unavailable. Allow location access to see stairs near you.'); }, { timeout: 10000, maximumAge: 60000 });
});
el('#featured').addEventListener('click', event => {
  if ((event.target as HTMLElement).closest('.circle-arrow')) {
    event.preventDefault();
    featuredIndex = (featuredIndex + 1) % featuredStairs.length;
    featured = featuredStairs[featuredIndex];
    renderFeatured();
    return;
  }
  selectStair(featured);
});
const about = el<HTMLDialogElement>('#about');
['about-button', 'credit-button', 'bottom-credit', 'legend-button'].forEach(id=> el('#'+id).addEventListener('click', () => about.showModal()));
el('.dialog-close').addEventListener('click', () => about.close());
about.addEventListener('click', event=>{if(event.target === about){const bounds=about.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)about.close();}});
document.addEventListener('keydown', event => {if(event.key === 'Escape' && !about.open)hideDetail();});
el('#locate').addEventListener('click', () => el<HTMLButtonElement>('#near-me').click());
el('#verification-close').addEventListener('click', () => el<HTMLDialogElement>('#verification-report').close());
el<HTMLFormElement>('#verification-form').addEventListener('submit', async event => {
  event.preventDefault(); const dialog = el<HTMLDialogElement>('#verification-report'); const form = event.currentTarget as HTMLFormElement; const status = el('#verification-status'); const fields = new FormData(form);
  status.textContent = 'Sending…';
  const response = await fetch('/api/verification-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stairId: dialog.dataset.stairId, type: fields.get('type'), details: fields.get('details'), contact: fields.get('contact') }) });
  status.textContent = response.ok ? 'Thanks — your report is queued for review.' : 'That report could not be sent. Please try again.';
  if (response.ok) form.reset();
});
handleImages(el('#app'));
render();
const initial = stairs.find(s => s.id === location.hash.slice(1));
if(initial)selectStair(initial);
new ResizeObserver(()=>map.invalidateSize()).observe(el('#map'));
