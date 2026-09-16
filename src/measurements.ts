import metrics from './stairway-metrics.json' with { type: 'json' };

/** How a stairway's step count was arrived at, in descending order of authority. */
export type StepSource = 'index' | 'osm-survey' | 'rise-estimate';

export type Measurement = {
  /** Height climbed from the bottom of the staircase to the top, in feet. */
  riseFeet: number;
  /** Horizontal distance covered, in feet. */
  runFeet: number;
  grade: number | null;
  steps: number;
  stepSource: StepSource;
  topFeet: number;
  bottomFeet: number;
  samples: number;
  resolutionMeters: number;
  matchMeters: number;
  osmWays: number[];
};

type Metrics = {
  generatedAt: string;
  elevationSource: string;
  geometrySource: string;
  osmTimestamp: string | null;
  riserInches: { short: number; tall: number; splitFeet: number };
  calibration: { countedStairways: number; medianRelativeError: number | null };
  stairways: Record<string, Measurement>;
};

// Measured once by scripts/build-stairway-metrics.py and committed to the repository,
// so a detail panel never waits on - or has to parse a response from - a live API.
const data = metrics as Metrics;

export const measurementSource = {
  elevation: data.elevationSource,
  geometry: data.geometrySource,
  generatedAt: data.generatedAt,
  /** Typical error of a rise-derived step count, as a percentage. */
  estimateErrorPercent: Math.round((data.calibration.medianRelativeError ?? 0) * 100)
};

export function measurementFor(id: string): Measurement | undefined {
  return Object.prototype.hasOwnProperty.call(data.stairways, id) ? data.stairways[id] : undefined;
}

/** The step count to show, and whether it was counted or inferred. */
export function stepReading(id: string, indexSteps: string) {
  const measurement = measurementFor(id);
  const counted = indexSteps.trim();
  if (/^\d+$/.test(counted)) return { steps: Number(counted), source: 'index' as StepSource };
  if (!measurement) return undefined;
  return { steps: measurement.steps, source: measurement.stepSource };
}

export const stepLabel = (steps: number, source: StepSource) =>
  source === 'rise-estimate' ? `~${steps} steps` : `${steps} steps`;

/** Short form for a result card: a step count when one is known, else the rating label. */
export const stepSummary = (id: string, indexSteps: string) => {
  const reading = stepReading(id, indexSteps);
  return reading ? stepLabel(reading.steps, reading.source) : undefined;
};

export const stepNote = (source: StepSource) =>
  source === 'index' ? 'Counted in the source index.'
  : source === 'osm-survey' ? 'Counted by OpenStreetMap surveyors.'
  : `Estimated from the measured rise, typically within ${measurementSource.estimateErrorPercent}%.`;

export const riseLabel = (measurement: Measurement) =>
  measurement.riseFeet >= 1 ? `${measurement.riseFeet} ft climb` : 'Level';

export const riseNote = (measurement: Measurement) =>
  `${measurement.bottomFeet} ft to ${measurement.topFeet} ft over ${measurement.runFeet} ft of ground, `
  + `from ${measurement.resolutionMeters <= 1 ? '1 m lidar' : `${measurement.resolutionMeters} m terrain`} samples.`;
