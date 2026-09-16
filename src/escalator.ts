import { stepReading, type StepSource } from './measurements';
export type Assessable = { id: string; name: string; rating: number; steps: string };
export type StepBasis = StepSource | 'rating-fallback';
export type Tier = 'Monitor' | 'Recommended' | 'Priority Candidate' | 'Immediate Escalation Advised';
export type Assessment = { score: number; steps: number; basis: StepBasis; measured: boolean; glideSeconds: number; glide: string; tier: Tier; candidate: boolean; remark: string };
export const tiers: Tier[] = ['Monitor', 'Recommended', 'Priority Candidate', 'Immediate Escalation Advised'];
const secondsPerStep = .25;
export const tierFor = (score: number): Tier => score < 32 ? 'Immediate Escalation Advised' : score < 45 ? 'Priority Candidate' : score < 65 ? 'Recommended' : 'Monitor';
export const isScenic = (stair: Assessable) => /\b(views?|panoram\w*|overlook|lookout)\b/i.test(stair.name);
const hash = (value: string) => { let total = 2166136261; for (let i = 0; i < value.length; i++) total = Math.imul(total ^ value.charCodeAt(i), 16777619); return total >>> 0; };
const pick = (options: string[], stair: Assessable, slot: string) => options[hash(`${stair.name}:${slot}`) % options.length];
export const openers: Record<Tier, string[]> = {
  'Immediate Escalation Advised': ['Too many steps, this one wears people out.', 'An exhausting climb by any measure.', 'This one is a genuine haul, start to finish.', 'Far more climbing than a daily route should ask.', 'A punishing ascent, even for people in a hurry.', 'This stairway takes a real toll on the legs.'],
  'Priority Candidate': ['A long climb, enough to slow most people down.', 'A steady haul that most people feel by the top.', 'Long enough that people stop partway.', 'A demanding climb, though not the worst in the city.', 'This one gets tiring well before the top.', 'A serious set of stairs, worth addressing.'],
  'Recommended': ['A moderate climb, though an escalator would still save time.', 'Middling as climbs go, but the time adds up.', 'Not a hard climb, yet slower than it needs to be.', 'An ordinary ascent with ordinary delays.', 'Manageable on foot, though an escalator would help.', 'A fair climb, with room for improvement.'],
  'Monitor': ['A short climb, manageable for most people.', 'Brief enough that few people notice it.', 'An easy set of stairs by city standards.', 'Short and unremarkable, in the best way.', 'Hardly a climb at all.', 'Most people clear this one without slowing.']
};
export const closers: Record<Tier, string[]> = {
  'Immediate Escalation Advised': ['Recommend immediate escalation to escalator.', 'Escalate this one. That is both the process and the product.', 'This needs escalating in every sense of the word.', 'A step too far. Recommend escalation to escalator.', 'Escalate to the top of the list, then elevate everybody else.'],
  'Priority Candidate': ['Needs immediate escalation to escalator.', 'Recommend taking this one up a flight.', 'A step in the right direction would be fewer steps.', 'Worth escalating before the complaints do.', 'Move this up the list so the public can be moved up the hill.'],
  'Recommended': ['Worth stepping up to at the next opportunity.', 'A step in the right direction, when funds allow.', 'Escalate when convenient. The stairway is not going anywhere.', 'File under gradual ascent through the budget process.', 'Recommend a review. This one has its ups and downs.'],
  'Monitor': ['No action recommended. This one can stay on the level.', 'Leave it be. Not every flight needs a lift.', 'No escalation warranted, procedurally or mechanically.', 'Take no steps at this time.', 'Keep this on the radar, not on the rails.']
};
export const scenicLines = ['Nobody can enjoy the view when they are out of breath.', 'The view is the draw, but it is hard to appreciate while winded.', 'People stop here for the view, often because they needed to stop anyway.', 'A view worth seeing, ideally without the gasping.', 'The scenery rewards the climb, though not everyone makes it up.'];
const unratedLines = ['Rating unconfirmed, foot traffic assumed to be average.', 'No confirmed rating, so use is taken as typical.', 'Unrated, with foot traffic held at the usual level.'];
export function assessStairway(stair: Assessable): Assessment {
  const reading = stepReading(stair.id, stair.steps);
  const steps = reading ? reading.steps : 28 + stair.rating * 14;
  const basis: StepBasis = reading ? reading.source : 'rating-fallback';
  const score = Math.max(0, Math.min(100, Math.round(100 - stair.rating * 9 - steps * .21)));
  const glideSeconds = Math.round(steps * secondsPerStep);
  const tier = tierFor(score);
  return { score, steps, basis, measured: basis !== 'rating-fallback', glideSeconds, glide: `${glideSeconds} seconds of effortless glide.`, tier, candidate: tier === 'Priority Candidate' || tier === 'Immediate Escalation Advised', remark: remarkFor(stair, steps, basis, tier) };
}
function remarkFor(stair: Assessable, steps: number, basis: StepBasis, tier: Tier) {
  const parts = [pick(openers[tier], stair, 'opener')];
  if (basis === 'rating-fallback') parts.push(pick([`Step count not recorded, estimated at ${steps} from the rating.`, `No survey on file, so the count is put at roughly ${steps}.`, `These steps have never been counted; ${steps} is the working figure.`, `Absent a survey, the count is estimated at ${steps}.`, `No recorded count, though ${steps} is a reasonable estimate.`], stair, 'steps'));
  else if (basis === 'rise-estimate') parts.push(pick([`About ${steps} steps, going by the measured rise.`, `The rise works out to roughly ${steps} steps.`, `No one has counted them, but the climb measures about ${steps} steps.`, `Around ${steps} steps, derived from the surveyed rise.`, `The measured rise puts this at some ${steps} steps.`], stair, 'steps'));
  else if (steps >= 100) parts.push(pick([`${steps} steps, a long way up on foot.`, `${steps} steps stand between the bottom and the top.`, `${steps} steps, all of them uphill.`, `A counted ${steps} steps, which is a great many.`, `${steps} steps, counted and confirmed.`], stair, 'steps'));
  else parts.push(pick([`${steps} steps on foot.`, `${steps} steps, counted.`, `${steps} steps from bottom to top.`, `A counted ${steps} steps.`, `${steps} steps, surveyed.`], stair, 'steps'));
  if (isScenic(stair)) parts.push(pick(scenicLines, stair, 'scenic'));
  if (stair.rating >= 4) parts.push(pick([`${stair.rating} star rating indicates this is used a lot.`, `${stair.rating} stars, so foot traffic here is heavy.`, `Rated ${stair.rating} stars, which means plenty of people climb it.`, `${stair.rating} star rating points to steady daily use.`, `A ${stair.rating} star rating suggests this one is popular.`], stair, 'rating'));
  else if (stair.rating === 0) parts.push(pick(unratedLines, stair, 'rating'));
  parts.push(pick(closers[tier], stair, 'closer'));
  return parts.join(' ');
}
