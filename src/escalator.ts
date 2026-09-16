export type Assessable = { name: string; rating: number; steps: string };
export type Tier = 'Monitor' | 'Recommended' | 'Priority Candidate' | 'Immediate Escalation Advised';
export type Assessment = { score: number; steps: number; provisional: boolean; glideSeconds: number; glide: string; tier: Tier; candidate: boolean; remark: string };
export const tiers: Tier[] = ['Monitor', 'Recommended', 'Priority Candidate', 'Immediate Escalation Advised'];
const secondsPerStep = .25;
export const tierFor = (score: number): Tier => score < 32 ? 'Immediate Escalation Advised' : score < 45 ? 'Priority Candidate' : score < 65 ? 'Recommended' : 'Monitor';
export const isScenic = (stair: Assessable) => /\b(views?|panoram\w*|overlook|lookout)\b/i.test(stair.name);
export function assessStairway(stair: Assessable): Assessment {
  const parsed = parseInt(stair.steps, 10);
  const provisional = !(parsed > 0);
  const steps = provisional ? 28 + stair.rating * 14 : parsed;
  const score = Math.max(0, Math.min(100, Math.round(100 - stair.rating * 9 - steps * .21)));
  const glideSeconds = Math.round(steps * secondsPerStep);
  const tier = tierFor(score);
  return { score, steps, provisional, glideSeconds, glide: `${glideSeconds} seconds of effortless glide.`, tier, candidate: tier === 'Priority Candidate' || tier === 'Immediate Escalation Advised', remark: remarkFor(stair, steps, provisional, tier) };
}
function remarkFor(stair: Assessable, steps: number, provisional: boolean, tier: Tier) {
  const long = steps >= 100, rated = stair.rating >= 4, scenic = isScenic(stair);
  const parts: string[] = [];
  parts.push({
    'Immediate Escalation Advised': 'Vertical throughput at this structure is materially below the network baseline.',
    'Priority Candidate': 'Pedestrian time cost at this structure exceeds the tolerance band for unassisted ascent.',
    'Recommended': 'Pedestrian time cost at this structure is measurable and would be reduced by mechanized conveyance.',
    'Monitor': 'Pedestrian time cost at this structure falls within accepted limits for unassisted ascent.'
  }[tier]);
  if (provisional) parts.push(`No surveyed step count is on file; a provisional count of ${steps} was imputed from the rating tier.`);
  else if (long) parts.push(`${steps} steps represents ${steps} discrete opportunities for pedestrian hesitation.`);
  else parts.push(`${steps} steps were surveyed; each remains an unassisted vertical transaction.`);
  if (scenic) parts.push('The scenic value cited by users is not currently capturable as throughput.');
  if (rated) parts.push(`A ${stair.rating}-star rating indicates elevated visitation and a correspondingly elevated aggregate delay.`);
  else if (stair.rating === 0) parts.push('Rating is unverified; visitation assumptions are held at the network median.');
  parts.push({
    'Immediate Escalation Advised': 'Recommend immediate escalation.',
    'Priority Candidate': 'Recommend inclusion in the next retrofit funding cycle.',
    'Recommended': 'Recommend a feasibility review at the next assessment interval.',
    'Monitor': 'No action recommended; continue to monitor.'
  }[tier]);
  return parts.join(' ');
}
