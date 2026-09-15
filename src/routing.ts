export interface RouteStair {
  id: string;
  name: string;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  steps: string;
  needsVerification: boolean;
}
export type Point = [number, number];
export interface Network {
  version: number;
  updatedAt: string;
  nodes: Point[];
  edges: [number, number, number][];
  snaps: Record<string, [number, number]>;
}
export interface RunRoute {
  stops: RouteStair[];
  points: Point[];
  nodeIds: number[];
  meters: number;
  legMeters: number[];
  loop: boolean;
}
type Edge = { to: number; meters: number };

export function distance(a: Point, b: Point): number {
  const lat = (a[0] + b[0]) * Math.PI / 360;
  return Math.hypot((a[0] - b[0]) * 111195, (a[1] - b[1]) * 111195 * Math.cos(lat));
}

class MinHeap {
  private items: { id: number; priority: number }[] = [];
  push(id: number, priority: number) {
    const item = { id, priority };
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].priority <= priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop(): number | undefined {
    if (!this.items.length) return;
    const first = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].priority < this.items[child].priority) child++;
        if (this.items[child].priority >= last.priority) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first.id;
  }
}

export class WalkingRouter {
  private adjacency: Edge[][];
  constructor(readonly network: Network) {
    this.adjacency = network.nodes.map(() => []);
    for (const [a, b, direction] of network.edges) {
      const meters = distance(network.nodes[a], network.nodes[b]);
      if (direction !== -1) this.adjacency[a].push({ to: b, meters });
      if (direction !== 1) this.adjacency[b].push({ to: a, meters });
    }
  }

  eligible(stair: RouteStair): boolean {
    return stair.lat !== null && stair.lng !== null && !stair.needsVerification && stair.id in this.network.snaps;
  }

  path(from: number, to: number): { nodes: number[]; meters: number } | null {
    if (!this.network.nodes[from] || !this.network.nodes[to]) return null;
    const costs = new Float64Array(this.network.nodes.length).fill(Infinity);
    const previous = new Int32Array(this.network.nodes.length).fill(-1);
    const visited = new Uint8Array(this.network.nodes.length);
    const heap = new MinHeap();
    costs[from] = 0;
    heap.push(from, 0);
    let current: number | undefined;
    while ((current = heap.pop()) !== undefined) {
      if (visited[current]) continue;
      if (current === to) {
        const nodes = [to];
        while (nodes[nodes.length - 1] !== from) nodes.push(previous[nodes[nodes.length - 1]]);
        return { nodes: nodes.reverse(), meters: costs[to] };
      }
      visited[current] = 1;
      for (const edge of this.adjacency[current]) {
        const nextCost = costs[current] + edge.meters;
        if (nextCost >= costs[edge.to]) continue;
        costs[edge.to] = nextCost;
        previous[edge.to] = current;
        heap.push(edge.to, nextCost + distance(this.network.nodes[edge.to], this.network.nodes[to]));
      }
    }
    return null;
  }

  connect(stops: RouteStair[], loop: boolean): RunRoute {
    if (stops.length < 2 || stops.length > 8 || new Set(stops.map(s => s.id)).size !== stops.length || stops.some(s => !this.eligible(s))) {
      throw new Error('Choose 2–8 different stairways with mapped walking access.');
    }
    const ordered = loop ? [...stops, stops[0]] : stops;
    const nodeIds: number[] = [];
    const legMeters: number[] = [];
    let meters = 0;
    for (let i = 1; i < ordered.length; i++) {
      const path = this.path(this.network.snaps[ordered[i - 1].id][0], this.network.snaps[ordered[i].id][0]);
      if (!path) throw new Error('These stairways are not connected in the walking map. Try a different starting point.');
      nodeIds.push(...(nodeIds.length ? path.nodes.slice(1) : path.nodes));
      meters += path.meters;
      legMeters.push(path.meters);
    }
    if (meters < 25) throw new Error('These access points are too close together. Choose a different starting point.');
    return { stops, points: nodeIds.map(id => this.network.nodes[id]), nodeIds, meters, legMeters, loop };
  }

  generate(stairs: RouteStair[], start: RouteStair, count: number, loop: boolean, variation = 0): RunRoute {
    if (![3, 5, 8].includes(count) || !this.eligible(start)) throw new Error('Choose a mapped starting stairway and 3, 5, or 8 stops.');
    const stops = [start];
    const startPoint = this.network.nodes[this.network.snaps[start.id][0]];
    const candidates = stairs.filter(s => this.eligible(s) && distance(startPoint, [s.lat!, s.lng!]) <= 3000);
    while (stops.length < count) {
      const current = stops[stops.length - 1];
      const currentNode = this.network.snaps[current.id][0];
      const options = candidates.filter(s => !stops.some(stop => stop.id === s.id || distance([stop.lat!, stop.lng!], [s.lat!, s.lng!]) < 35 || this.network.snaps[stop.id][0] === this.network.snaps[s.id][0]))
        .sort((a, b) => distance(this.network.nodes[currentNode], [a.lat!, a.lng!]) - distance(this.network.nodes[currentNode], [b.lat!, b.lng!]));
      const offset = variation % Math.min(4, options.length || 1);
      const ordered = [...options.slice(offset), ...options.slice(0, offset)];
      const next = ordered.find(s => {
        const path = this.path(currentNode, this.network.snaps[s.id][0]);
        return path !== null && path.meters <= 4000 && (!loop || this.path(this.network.snaps[s.id][0], this.network.snaps[start.id][0]) !== null);
      });
      if (!next) throw new Error(`Could not connect ${count} distinct stairways nearby. Try fewer stops or a different starting point.`);
      stops.push(next);
    }
    return this.connect(stops, loop);
  }
}

let routerPromise: Promise<WalkingRouter> | undefined;
export function loadRouter(): Promise<WalkingRouter> {
  routerPromise ??= fetch('/walking-network.json', { signal: AbortSignal.timeout(20000) }).then(async response => {
    if (!response.ok) throw new Error('The walking map could not load. Please try again.');
    const network: Network = await response.json();
    if (network.version !== 1 || !Array.isArray(network.nodes) || !Array.isArray(network.edges) || !network.snaps) throw new Error('The walking map is unavailable. Please try again.');
    return new WalkingRouter(network);
  }).catch(error => { routerPromise = undefined; throw error; });
  return routerPromise;
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
}
export function toGpx(route: RunRoute): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SF Stairs" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>SF Stairs — ${xml(route.stops[0].neighborhood)}</name><desc>Route between nearby stairway access points. Stair climbs, closures, and elevation are not verified. Walking data © OpenStreetMap contributors, ODbL 1.0.</desc></metadata>${route.stops.map((s, i) => `<wpt lat="${s.lat}" lon="${s.lng}"><name>${i + 1}. ${xml(s.name)}</name></wpt>`).join('')}<trk><name>SF stair run</name><trkseg>${route.points.map(([lat, lng]) => `<trkpt lat="${lat}" lon="${lng}"/>`).join('')}</trkseg></trk></gpx>`;
}
