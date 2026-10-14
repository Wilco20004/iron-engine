import { z } from 'zod';

// The shape of a training plan. Program templates (server/programs/*.json),
// each block's copy of its plan, and plans written through the connector are
// all checked against this.

const Phase = z.tuple([
  z.string().min(1).max(40),
  z.number().int().positive().max(7200),
  z.enum(['warm', 'hard', 'easy', 'cool', 'steady']),
]);

export const LiftSchema = z.object({
  name: z.string().min(1).max(80).describe('Exercise name. Match an exercise library name to get photos and how-to steps.'),
  sets: z.number().int().min(1).max(10).describe('Working sets in a normal week (weeks scale this with setScale / extraSets).'),
  reps: z.string().min(1).max(30).describe('Rep target as shown, e.g. "6–8", "10 / leg", "20 s / side".'),
  rest: z.string().min(1).max(20).describe('Rest between sets, e.g. "90 s" or "2–3 min" (drives the rest timer).'),
  cue: z.string().max(200).default('').describe('One short coaching cue.'),
  main: z.boolean().default(false).describe('Main lift: gets the extra set in weeks with extraSets.'),
  pair: z.string().max(4).optional().describe('Superset label such as "A1" / "A2".'),
  caution: z.string().max(400).optional().describe('Person-specific caution shown with a ⚠, e.g. an injury note.'),
});

const CardioSchema = z.object({
  kind: z.string().min(1).max(60).describe('e.g. "Bike intervals", "Incline treadmill walk".'),
  zone: z.string().min(1).max(30).describe('"Zone 2" for easy steady work; anything else is treated as intervals.'),
  pct: z.tuple([z.number().min(40).max(100), z.number().min(40).max(100)]).describe('Target heart-rate range as % of max HR.'),
  steps: z.array(z.string().max(200)).max(8),
  phases: z.array(Phase).min(1).max(60).describe('Timer phases: [label, seconds, kind].'),
});

const DayName = z.string().min(1).max(4);

const RestDaySchema = z.object({
  d: DayName,
  rest: z.literal(true),
  title: z.string().min(1).max(40),
  focus: z.string().max(60).default(''),
  items: z.array(z.string().max(300)).max(10).default([]),
});

const TrainingDaySchema = z.object({
  d: DayName,
  rest: z.literal(false).optional(),
  title: z.string().min(1).max(40),
  focus: z.string().max(60).default(''),
  warm: z.number().int().min(0).max(60).describe('Warm-up minutes.'),
  iron: z.number().int().min(0).max(180).describe('Weights minutes.'),
  engine: z.number().int().min(0).max(120).describe('Cardio minutes.'),
  lifts: z.array(LiftSchema).min(1).max(15),
  cardio: CardioSchema,
});

const WeekSchema = z.object({
  name: z.string().min(1).max(30),
  tag: z.string().max(20).default(''),
  rir: z.number().min(0).max(5).describe('Reps in reserve target for the week.'),
  extraSets: z.number().int().min(0).max(3).default(0),
  setScale: z.number().min(0.3).max(1.5).default(1).describe('Multiplies every lift\'s sets, e.g. 0.5 for a deload.'),
  note: z.string().max(400).default('').describe('Shown at the top of each session that week. May contain <b>.</b>'),
  cardio: z.enum(['normal', 'deload']).default('normal').describe('"deload" swaps all cardio for short easy Zone 2.'),
});

export const PlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,60}$/).describe('Template id (lowercase letters, digits, dashes).'),
  name: z.string().min(1).max(60),
  subtitle: z.string().max(120).optional(),
  goal: z.string().max(60).optional(),
  lede: z.string().max(600).optional(),
  notice: z.string().max(800).optional().describe('Highlighted note under the title, e.g. injury guidance.'),
  daysPerWeek: z.string().max(30).optional(),
  sessionLength: z.string().max(30).optional(),
  deloadCardio: z.object({ minutes: z.number().int().min(5).max(60) }).optional(),
  weeks: z.array(WeekSchema).min(1).max(12),
  days: z.array(z.union([RestDaySchema, TrainingDaySchema])).min(1).max(7),
  rules: z.array(z.tuple([z.string().max(40), z.string().max(30), z.string().max(400)])).max(10).default([]),
}).superRefine((plan, ctx) => {
  plan.days.forEach((day, di) => {
    if ('lifts' in day) {
      const seen = new Set<string>();
      day.lifts.forEach((l, li) => {
        const s = slug(l.name);
        if (s === 'cardio' || s === 'end' || s === 'watch') ctx.addIssue({ code: 'custom', path: ['days', di, 'lifts', li, 'name'], message: `"${l.name}" is a reserved name` });
        if (seen.has(s)) ctx.addIssue({ code: 'custom', path: ['days', di, 'lifts', li, 'name'], message: `"${l.name}" appears twice on ${day.d}` });
        seen.add(s);
      });
    }
  });
});

export type Plan = z.infer<typeof PlanSchema>;

// Log keys are "<week>-<day>-<exercise slug>", plus "-cardio", "-end" and
// "-watch" (the Garmin activity's heart rate and calories), so
// reordering or swapping exercises never mixes up logged history.
export function slug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
}

export const KEY_RE = /^\d{1,2}-\d{1,2}-[a-z0-9-]{1,60}$/;

export function parseKey(key: string) {
  const m = key.match(/^(\d{1,2})-(\d{1,2})-(.+)$/);
  return m ? { week: +m[1], day: +m[2], item: m[3] } : null;
}

// Old keys used the exercise's position ("0-0-3"). Convert to the slug form.
export function upgradeKey(plan: Plan, key: string): string | null {
  const k = parseKey(key);
  if (!k) return null;
  if (!/^\d+$/.test(k.item)) return KEY_RE.test(key) ? key : null;
  const day = plan.days[k.day];
  if (!day || !('lifts' in day)) return null;
  const i = +k.item;
  if (i === day.lifts.length) return `${k.week}-${k.day}-cardio`;
  const lift = day.lifts[i];
  return lift ? `${k.week}-${k.day}-${slug(lift.name)}` : null;
}

export function formatIssues(err: z.ZodError): string {
  return err.issues.slice(0, 12).map(i => `${i.path.join('.') || '(plan)'}: ${i.message}`).join('\n');
}
