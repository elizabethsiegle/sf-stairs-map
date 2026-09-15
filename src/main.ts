import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
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
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>'
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
const featured = stairs.find(stair => stair.name.includes('Tompkins') && stair.image) || stairs.find(stair => stair.image)!;
let rating = 'all';
let query = '';
let neighborhood = '';
let photosOnly = false;
let visible: Stair[] = [];
let selected: Stair | undefined;
let pageSize = 45;
let routeStops: RouteStop[] = [];

el('#app').innerHTML = `
  <header class="header">
    <a class="brand" href="/" aria-label="SF Stairs home"><span class="brand-icon">${icon('stairs', 25)}</span><span>SF Stairs</span></a>
    <div class="header-note">San Francisco public stairways</div>
    <button id="about-button" class="text-button">About this map ${icon('arrow', 16)}</button>
  </header>
  <main>
    <section class="intro">
      <div class="intro-copy"><div class="eyebrow"><span></span> San Francisco’s public stairways</div>
        <h1>Find the stairs<br>worth taking.</h1>
        <p>A working map of the city’s shortcuts, climbs, painted steps, and tucked-away paths. Pick a neighborhood, zoom in, and see what’s there.</p>
        <div class="intro-bottom"><span><strong>${stairs.filter(s => s.lat !== null).length.toLocaleString()}</strong> mapped locations</span><span class="divider"></span><span>Source collection: <button id="credit-button">Urban Hiker SF ↗</button></span></div>
      </div>
      <button id="featured" class="featured" aria-label="Explore ${escape(featured.name)}"><img src="${escape(featured.image!)}" alt="${escape(featured.name)}" fetchpriority="high"><span class="featured-shade"></span><span class="photo-stamp">Featured stairway</span><span class="featured-caption"><span>${escape(featured.name.split('/')[0])}<small>${escape(featured.neighborhood)} · ★ ${featured.rating} rated</small></span><span class="circle-arrow">${icon('arrow')}</span></span></button>
    </section>
    <section class="explorer" aria-label="Explore stairways">
      <div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search a stairway, street, or neighborhood" aria-label="Search stairways"></label><div class="toolbar-right"><label class="select-wrap">${icon('pin', 17)}<select id="neighborhood" aria-label="Neighborhood"><option value="">All neighborhoods</option>${neighborhoods.map(n => `<option>${escape(n)}</option>`).join('')}</select></label><button id="route-toggle" class="route-toggle" aria-expanded="false">${icon('route', 17)} Plan a stair route</button><button id="surprise" class="surprise">${icon('shuffle', 17)} Surprise me</button></div></div>
      <div class="filter-bar"><span class="filter-label">Rating</span><div class="rating-filters"><button class="chip active" data-rating="all" aria-pressed="true">All</button>${[5,4,3,2,1].map(r => `<button class="chip" data-rating="${r}" aria-pressed="false"><span class="dot" style="--dot:${colors[r]}"></span>${r}<span class="chip-extra"> · ${['','','Favorite','Hidden gem','Notable','Everyday'][r] || 'Everyday'}</span></button>`).join('')}</div><label class="photo-filter"><input type="checkbox" id="photos-only"> Photo links only</label></div>
      <div class="explorer-body"><aside class="results-panel"><div class="results-heading"><div><h2>Stairways</h2><p id="result-count" aria-live="polite"></p></div><button id="reset" class="reset">Clear filters</button></div><div id="results" class="results"></div></aside><div class="map-wrap"><div id="map" aria-label="Interactive San Francisco stairway map"></div><div class="map-badge"><span class="live-dot"></span> Map data from the Urban Hiker SF collection</div><div class="map-actions"><button id="locate" aria-label="Find my location" title="Find my location">${icon('locate')}</button><button id="fit" aria-label="Fit all filtered stairways" title="Fit all filtered stairways">${icon('pin')}</button></div><section id="route-planner" class="route-planner" hidden aria-labelledby="route-title"><button id="route-close" class="route-close" aria-label="Close route planner">${icon('close', 17)}</button><div class="eyebrow"><span></span> Walk planner</div><h2 id="route-title">A good day for stairs.</h2><p>Make a compact route from the stairways in your current results.</p><label class="route-count">Stops <select id="route-count" aria-label="Number of stairway stops">${[3,4,5,6,7,8].map(count => `<option value="${count}"${count === 4 ? ' selected' : ''}>${count} stairways</option>`).join('')}</select></label><button id="route-generate" class="route-generate">${icon('shuffle', 16)} Generate a route</button><p id="route-note" class="route-note" aria-live="polite"></p><div id="route-output" class="route-output" hidden><div class="route-summary"><span id="route-distance"></span><span id="route-time"></span></div><ol id="route-stops" class="route-stops"></ol><div class="route-actions"><button id="route-remix">${icon('shuffle', 15)} Try another</button><a id="route-directions" target="_blank" rel="noopener noreferrer">Open walking directions ${icon('external', 15)}</a></div></div></section><details class="map-legend" open><summary>Rating guide <span>⌃</span></summary><div>${[5,4,3,2,1,0].map(r=>`<div><span class="dot" style="--dot:${colors[r]}"></span><b>${r || '?'}</b> ${labels[r]}</div>`).join('')}<button id="legend-button">Read the source legend ↗</button></div></details><div id="detail" class="detail" hidden></div><p id="map-status" role="status" hidden></p></div></div>
    </section>
    <section class="credit-strip"><span class="credit-mark">${icon('stairs',28)}</span><p>Built from the stairway map by <button id="bottom-credit">Alexandra Kenin / Urban Hiker SF</button>.<br><span>Based on the index of <em>Stairway Walks of San Francisco</em> by Mary Burk and Adah Bakalinsky.</span></p><a href="${sourceSheet}" target="_blank" rel="noopener noreferrer">Open the source collection ${icon('external',15)}</a></section>
  </main>
  <footer><span>San Francisco, California</span><span>made w/ <span class="heart">&lt;3</span> in sf</span><span>Use good judgment on the stairs.</span></footer>
  <dialog id="about"><button class="dialog-close" aria-label="Close about dialog">${icon('close')}</button><div class="eyebrow">THE PEOPLE BEHIND THE PATHS</div><h2>A city discovered<br>one stairway at a time.</h2><p>This independent project pays homage to <strong>Alexandra Kenin and Urban Hiker SF</strong>, whose public stairway map and photo collection make these discoveries possible.</p><p>The collection is based on the index of <em>Stairway Walks of San Francisco</em> by <strong>Mary Burk and Adah Bakalinsky</strong>, with additional stairways documented by Urban Hiker SF.</p><div class="source-links"><a href="${sourceSheet}" target="_blank" rel="noopener noreferrer">Original spreadsheet ↗</a><a href="${sourceMap}" target="_blank" rel="noopener noreferrer">Original map ↗</a><a href="https://www.urbanhikersf.com" target="_blank" rel="noopener noreferrer">Urban Hiker SF ↗</a><a href="https://www.buymeacoffee.com/urbanhikersf" target="_blank" rel="noopener noreferrer">Buy Alexandra a matcha ↗</a></div><h3>Keep in touch with Urban Hiker SF</h3><a href="mailto:info@urbanhikersf.com">info@urbanhikersf.com</a><p><a href="https://www.instagram.com/urbanhikersf/" target="_blank" rel="noopener noreferrer">Instagram: @urbanhikersf</a> · <a href="https://twitter.com/urbanhikersf" target="_blank" rel="noopener noreferrer">Twitter: @urbanhikersf</a><br><a href="https://www.facebook.com/urbanhikersf" target="_blank" rel="noopener noreferrer">Facebook: facebook.com/urbanhikersf</a></p><h3>The original rating legend</h3><p class="muted">Ratings describe a stairway’s character, not walking difficulty. Explanations below paraphrase the source legend.</p><div class="full-legend">${[5,4,3,2,1,0].map(r=>`<div><span class="legend-number" style="background:${colors[r]}">${r || '?'}</span><p><strong>${labels[r]}</strong><br>${legendDescriptions[r]}</p></div>`).join('')}</div><p class="muted">Beige rows in the original spreadsheet identify additions beyond the book’s index. This site does not reproduce that row formatting.</p><h3>About this collection</h3><p class="muted">Imported September 14, 2026; the source map says it was last updated July 26, 2026. Spreadsheet ratings take precedence for matched entries. Map-only entries retain their map rating. Entries without matched coordinates stay in the list. Locations and access may change; follow posted signs.</p><p class="muted">Photo previews and album links come from the source collection. Photo credits remain with their original creators; additional credits appear with individual entries. This site is not affiliated with Urban Hiker SF.</p></dialog>`;

const map = L.map('map', {zoomControl: false, preferCanvas: true}).setView([37.759, -122.445], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).on('tileerror', () => status('Map tiles could not load. You can still browse stairways in the list.')).addTo(map);
L.control.zoom({position: 'topright'}).addTo(map);
const markers = L.layerGroup().addTo(map);
const routeLines = L.layerGroup().addTo(map);
let selectedMarker: L.CircleMarker | undefined;
function mappedStops(): RouteStop[] {
  return visible.filter((stair): stair is RouteStop => stair.lat !== null && stair.lng !== null);
}
function distanceMiles(a: RouteStop, b: RouteStop) {
  const radians = Math.PI / 180;
  const lat = (b.lat - a.lat) * radians;
  const lng = (b.lng - a.lng) * radians;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(lng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function formatDistance(miles: number) {
  return miles < 1 ? `${Math.max(100, Math.round(miles * 5280 / 50) * 50)} ft` : `${miles.toFixed(1)} mi`;
}
function routeUrl(stops: RouteStop[]) {
  const params = new URLSearchParams({
    api: '1',
    origin: `${stops[0].lat},${stops[0].lng}`,
    destination: `${stops[0].lat},${stops[0].lng}`,
    travelmode: 'walking'
  });
  if (stops.length > 1) params.set('waypoints', stops.slice(1).map(stop => `${stop.lat},${stop.lng}`).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}
function drawRoute() {
  routeLines.clearLayers();
  if (routeStops.length < 2) return;
  L.polyline([...routeStops, routeStops[0]].map(stop => [stop.lat, stop.lng]), {color: '#ce4b2d', weight: 4, opacity: .9, dashArray: '7 7'}).addTo(routeLines);
  routeStops.forEach((stop, index) => L.marker([stop.lat, stop.lng], {icon: L.divIcon({className: 'route-marker', html: `<span>${index + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13]})}).bindTooltip(escape(stop.name), {direction: 'top'}).on('click', () => selectStair(stop)).addTo(routeLines));
}
function clearRoute(message = '') {
  routeStops = [];
  routeLines.clearLayers();
  el('#route-output').hidden = true;
  el('#route-note').textContent = message;
}
function showRoute() {
  const loop = [...routeStops.slice(1), routeStops[0]];
  const distance = loop.reduce((total, stop, index) => total + distanceMiles(routeStops[index], stop), 0) * 1.28;
  const minutes = Math.max(12, Math.round(distance * 23));
  el('#route-distance').textContent = `About ${formatDistance(distance)}`;
  el('#route-time').textContent = `~${minutes} min of walking`;
  el('#route-stops').innerHTML = routeStops.map(stop => `<li><button data-route-stop="${stop.id}"><span>${escape(stop.name)}</span><small>${escape(stop.neighborhood)}</small></button></li>`).join('');
  el<HTMLAnchorElement>('#route-directions').href = routeUrl(routeStops);
  el('#route-output').hidden = false;
  el('#route-note').textContent = 'Estimated distance follows the line between stops. Walking directions use the street network.';
  el('#route-stops').querySelectorAll<HTMLButtonElement>('[data-route-stop]').forEach(button => button.addEventListener('click', () => selectStair(routeStops.find(stop => stop.id === button.dataset.routeStop)!)));
  drawRoute();
  map.fitBounds(L.latLngBounds(routeStops.map(stop => [stop.lat, stop.lng])), {padding: [54, 54], maxZoom: 15, animate: false});
}
function generateRoute() {
  const count = Number(el<HTMLSelectElement>('#route-count').value);
  const candidates = mappedStops();
  if (candidates.length < 2) {
    clearRoute('Try clearing a filter. This set needs at least two mapped stairways.');
    return;
  }
  const target = Math.min(count, candidates.length);
  const start = selected && candidates.find(stair => stair.id === selected!.id) || candidates[Math.floor(Math.random() * candidates.length)];
  const remaining = candidates.filter(stair => stair.id !== start.id);
  routeStops = [start];
  while (routeStops.length < target && remaining.length) {
    const current = routeStops.at(-1)!;
    const nearby = remaining.map(stair => ({stair, distance: distanceMiles(current, stair)})).sort((a, b) => a.distance - b.distance);
    const choice = nearby[Math.floor(Math.random() * Math.min(3, nearby.length))].stair;
    routeStops.push(choice);
    remaining.splice(remaining.findIndex(stair => stair.id === choice.id), 1);
  }
  showRoute();
}
function status(message: string) {el('#map-status').textContent = message;el('#map-status').hidden = false;}
function hideDetail() {el('#detail').hidden = true; selected = undefined;if(selectedMarker)map.removeLayer(selectedMarker); history.replaceState(null, '', location.pathname + location.search);}
function selectStair(stair: Stair) {
  selected = stair;
  history.replaceState(null, '', `#${stair.id}`);
  const detail = el('#detail');
  detail.hidden = false;
  detail.innerHTML = `<button class="detail-close" aria-label="Close stairway details">${icon('close')}</button>${stair.image ? `<a class="detail-image-link" href="${escape(stair.photos[0])}" target="_blank" rel="noopener noreferrer"><img class="detail-image" src="${escape(stair.image)}" alt="${escape(stair.name)}"><span>Photos from the Urban Hiker SF collection ↗</span></a>` : ''}<div class="detail-content"><div class="eyebrow">${escape(stair.neighborhood)}</div><h2>${escape(stair.name)}</h2><div class="detail-tags"><span class="rating-tag" style="--dot:${colors[stair.rating]}">${stair.rating ? '★ ' + stair.rating + ' / 5' : '? Unrated'}</span><span>${labels[stair.rating]}</span>${stair.steps ? `<span>${escape(stair.steps)} steps</span>` : ''}</div>${stair.needsVerification ? '<p class="notice">This location needs verification in the original map.</p>' : ''}${stair.lat === null ? '<p class="notice">Listed in the spreadsheet; no matched map coordinates.</p>' : ''}<div class="detail-links">${stair.photos.map((url, i)=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${icon('camera',16)} ${i ? 'More photos' : 'View original photos'} ↗</a>`).join('')}${stair.lat !== null ? `<a class="directions" href="https://www.google.com/maps/dir/?api=1&destination=${stair.lat},${stair.lng}&travelmode=walking" target="_blank" rel="noopener noreferrer">Walking directions ${icon('arrow',16)}</a>` : ''}</div>${!stair.photos.length ? '<p class="muted">No photos linked in the source collection yet.</p>' : ''}${/photo by/i.test(stair.photoNote) ? `<p class="muted">${escape(stair.photoNote.replace(/https:\/\/\S+/g, '').trim())}</p>` : ''}${'row' in stair ? `<a class="source-row" href="${sourceSheet}&range=B${stair.row}:F${stair.row}" target="_blank" rel="noopener noreferrer">View spreadsheet entry ↗</a>` : `<a class="source-row" href="${sourceMap}" target="_blank" rel="noopener noreferrer">View original map ↗</a>`}</div>`;
  detail.querySelector('button')!.addEventListener('click', hideDetail);
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
function handleImages(parent: HTMLElement) {
  parent.querySelectorAll<HTMLImageElement>('img').forEach(img => img.addEventListener('error', () => {img.hidden = true; img.parentElement?.classList.add('image-unavailable');}, {once: true}));
}
function renderList() {
  const results = el('#results');
  results.innerHTML = visible.length ? visible.slice(0, pageSize).map(stair => `<button class="stair-card" data-id="${stair.id}"><span class="thumbnail ${stair.image ? '' : 'no-photo'}" style="--tint:${colors[stair.rating]}">${stair.image ? `<img src="${escape(stair.image)}" alt="" loading="lazy">` : icon('stairs', 29)}<span class="small-rating" style="background:${colors[stair.rating]}">${stair.rating || '?'}</span></span><span class="card-copy"><span class="neighborhood">${escape(stair.neighborhood)}</span><span class="stair-name">${escape(stair.name)}</span><span class="card-meta">${stair.steps ? escape(stair.steps) + ' steps' : labels[stair.rating]}${stair.photos.length ? ` <span>· ${icon('camera',12)}</span>` : ''}${stair.lat === null ? ' · Not mapped' : ''}</span></span><span class="card-arrow">↗</span></button>`).join('') + (visible.length > pageSize ? '<button id="load-more">Show more stairways ↓</button>' : '') : '<div class="empty"><h3>No stairs found.</h3><p>Try another street, neighborhood, or rating.</p><button id="empty-reset">Clear filters</button></div>';
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
  visible = stairs.filter(stair => (rating === 'all' || stair.rating === Number(rating)) && (!neighborhood || stair.neighborhood === neighborhood) && (!photosOnly || stair.photos.length > 0) && `${stair.name} ${stair.neighborhood}`.toLowerCase().includes(query.toLowerCase().trim()));
  if (routeStops.some(stop => !visible.some(stair => stair.id === stop.id))) clearRoute('Your filters changed. Generate a route from these results.');
  pageSize = 45;
  const mapped = visible.filter(s=>s.lat!==null).length;
  el('#result-count').textContent = `${visible.length.toLocaleString()} stairways · ${mapped.toLocaleString()} on the map`;
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
  rating = 'all'; query = ''; neighborhood = ''; photosOnly = false;
  el<HTMLInputElement>('#search').value = '';el<HTMLSelectElement>('#neighborhood').value = '';el<HTMLInputElement>('#photos-only').checked = false;
  hideDetail(); render(); map.setView([37.759, -122.445], 12);
}
el<HTMLInputElement>('#search').addEventListener('input', event => {query = (event.target as HTMLInputElement).value;render(true);});
el<HTMLSelectElement>('#neighborhood').addEventListener('change', event => {neighborhood = (event.target as HTMLSelectElement).value;render(true);});
el<HTMLInputElement>('#photos-only').addEventListener('change', event => {photosOnly = (event.target as HTMLInputElement).checked;render();});
document.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach(button => button.addEventListener('click', () => {rating = button.dataset.rating!;render();}));
el('#reset').addEventListener('click', reset);
el('#fit').addEventListener('click', fit);
el('#surprise').addEventListener('click', () => {if(visible.length)selectStair(visible[Math.floor(Math.random() * visible.length)]);});
const routePlanner = el<HTMLElement>('#route-planner');
el<HTMLButtonElement>('#route-toggle').addEventListener('click', () => {
  routePlanner.hidden = !routePlanner.hidden;
  el<HTMLButtonElement>('#route-toggle').setAttribute('aria-expanded', String(!routePlanner.hidden));
  if (!routePlanner.hidden && !routeStops.length) el('#route-note').textContent = 'Use your filters to shape the route, then choose how many stairways to visit.';
});
el('#route-close').addEventListener('click', () => {
  routePlanner.hidden = true;
  el<HTMLButtonElement>('#route-toggle').setAttribute('aria-expanded', 'false');
});
el('#route-generate').addEventListener('click', generateRoute);
el('#route-remix').addEventListener('click', generateRoute);
el('#featured').addEventListener('click', () => selectStair(featured));
const about = el<HTMLDialogElement>('#about');
['about-button', 'credit-button', 'bottom-credit', 'legend-button'].forEach(id=> el('#'+id).addEventListener('click', () => about.showModal()));
el('.dialog-close').addEventListener('click', () => about.close());
about.addEventListener('click', event=>{if(event.target === about){const bounds=about.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)about.close();}});
document.addEventListener('keydown', event => {if(event.key === 'Escape' && !about.open)hideDetail();});
el('#locate').addEventListener('click', () => {
  if(!navigator.geolocation){status('Your browser does not support location. Search a neighborhood instead.');return;}
  status('Finding your location…');
  navigator.geolocation.getCurrentPosition(position=> {
    const {latitude, longitude} = position.coords;
    if(latitude<37.6||latitude>37.9||longitude< -122.6||longitude> -122.3){status('You’re outside San Francisco. Pick a neighborhood to plan your next walk.');return;}
    map.setView([latitude, longitude], 15);
    L.circleMarker([latitude, longitude], {radius: 8, color: 'white', weight: 3, fillColor: '#2364d2', fillOpacity: 1}).bindTooltip('Your location').addTo(map);
    status('Your location is shown in blue.');
  }, ()=>status('Location unavailable. Allow location access or search a neighborhood.'), {timeout: 10000, maximumAge: 60000});
});
handleImages(el('#app'));
render();
const initial = stairs.find(s => s.id === location.hash.slice(1));
if(initial)selectStair(initial);
new ResizeObserver(()=>map.invalidateSize()).observe(el('#map'));
