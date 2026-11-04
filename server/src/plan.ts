import { z } from 'zod';

// The shape of a training plan. Program templates (server/programs/*.json),
// each block's copy of its plan, and plans written through the connector are
// all checked against this.
//
// A block runs in calendar weeks (Monday to Sunday) from the day it started.
// Each week is a checklist of workouts, done on any day in any order; a week
// can have its own list (weeks[n].workouts) or skip some (weeks[n].skip),
// without touching the other weeks.

const Phase = z.tuple([
  z.string().min(1).max(40),
  z.number().int().positive().max(7200),
  z.enum(['warm', 'hard', 'easy', 'cool', 'steady']),
]);

const GoalSchema = z.object({
  reps: z.number().int().min(1).max(200).describe('Reps (or seconds, for timed holds) per set at the goal.'),
  kg: z.number().min(0).max(500).optional().describe('Weight at the goal; leave out for bodyweight goals such as strict pull-ups.'),
  sets: z.number().int().min(1).max(10).default(1).describe('How many sets must reach it, e.g. 3 for "3 × 10".'),
  note: z.string().max(120).optional().describe('Why, or how it should look, e.g. "strict, full range".'),
});

export const LiftSchema = z.object({
  name: z.string().min(1).max(80).describe('Exercise name. Match an exercise library name to get photos and how-to steps.'),
  sets: z.number().int().min(1).max(10).describe('Working sets in a normal week (weeks scale this with setScale / extraSets).'),
  reps: z.string().min(1).max(30).describe('Rep target as shown, e.g. "6–8", "10 / leg", "20 s / side". A range drives double progression.'),
  rest: z.string().min(1).max(20).describe('Rest between sets, e.g. "90 s" or "2–3 min" (drives the rest timer). In a superset, the rest after the last exercise of the round.'),
  cue: z.string().max(200).default('').describe('One short coaching cue.'),
  main: z.boolean().default(false).describe('Main lift: gets the extra set in weeks with extraSets.'),
  pair: z.string().regex(/^[A-Za-z][1-9]$/).optional().describe('Superset label: "A1" and "A2" are done back to back, resting after A2.'),
  caution: z.string().max(400).optional().describe('Person-specific caution shown with a ⚠, e.g. an injury note.'),
  goal: GoalSchema.optional().describe('What this exercise is building towards, e.g. { "sets": 3, "reps": 10 } for 3 × 10 strict pull-ups.'),
  progress: z.enum(['load', 'reps', 'none']).optional().describe('How to build up: "load" adds weight once every set reaches the top of the rep range; "reps" adds a rep (bodyweight, holds). Default from the exercise\'s load type.'),
  step: z.number().min(0.25).max(20).optional().describe('kg to add when progressing by load (default 2.5 barbell, 2 dumbbell, 5 machine).'),
});

const CardioSchema = z.object({
  kind: z.string().min(1).max(60).describe('e.g. "Bike intervals", "Incline treadmill walk".'),
  zone: z.string().min(1).max(30).describe('"Zone 2" for easy steady work; anything else is treated as intervals.'),
  pct: z.tuple([z.number().min(40).max(100), z.number().min(40).max(100)]).describe('Target heart-rate range as % of max HR.'),
  steps: z.array(z.string().max(200)).max(8),
  phases: z.array(Phase).min(1).max(60).describe('Timer phases: [label, seconds, kind].'),
});

export const WorkoutSchema = z.object({
  title: z.string().min(1).max(40).describe('e.g. "Upper A". Workouts have no weekday: they are done in any order through the week.'),
  focus: z.string().max(60).default(''),
  warm: z.number().int().min(0).max(60).describe('Warm-up minutes.'),
  iron: z.number().int().min(0).max(180).describe('Weights minutes.'),
  engine: z.number().int().min(0).max(120).describe('Cardio minutes.'),
  lifts: z.array(LiftSchema).min(1).max(15),
  cardio: CardioSchema,
});

const OffDaySchema = z.object({
  title: z.string().min(1).max(40),
  focus: z.string().max(60).default(''),
  items: z.array(z.string().max(300)).max(10).default([]),
});

const WeekSchema = z.object({
  name: z.string().min(1).max(30),
  tag: z.string().max(20).default(''),
  rir: z.number().min(0).max(5).describe('Reps in reserve target for the week.'),
  extraSets: z.number().int().min(0).max(3).default(0),
  setScale: z.number().min(0.3).max(1.5).default(1).describe('Multiplies every lift\'s sets, e.g. 0.5 for a deload.'),
  note: z.string().max(400).default('').describe('Shown at the top of each session that week. May contain <b>.</b>'),
  cardio: z.enum(['normal', 'deload']).default('normal').describe('"deload" swaps all cardio for short easy Zone 2.'),
  workouts: z.array(WorkoutSchema).min(1).max(7).optional().describe('This week only: its own workout list instead of the plan\'s. Leave out to use the plan\'s workouts.'),
  skip: z.array(z.number().int().min(0).max(6)).max(7).default([]).describe('This week only: workouts (by position) that are skipped, e.g. for a holiday.'),
});

const PlanObject = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,60}$/).describe('Template id (lowercase letters, digits, dashes).'),
  name: z.string().min(1).max(60),
  subtitle: z.string().max(120).optional(),
  goal: z.string().max(60).optional(),
  lede: z.string().max(600).optional(),
  notice: z.string().max(800).optional().describe('Highlighted note under the title, e.g. injury guidance.'),
  daysPerWeek: z.string().max(30).optional(),
  sessionLength: z.string().max(30).optional(),
  deloadCardio: z.object({ minutes: z.number().int().min(5).max(60) }).optional(),
  weeks: z.array(WeekSchema).min(1).max(12).describe('Calendar weeks from the block\'s start (Monday to Sunday).'),
  workouts: z.array(WorkoutSchema).min(1).max(7).describe('The workouts to do each week, in the order they are suggested.'),
  offDays: z.array(OffDaySchema).max(7).default([]).describe('Suggestions for the other days, e.g. walks or rest.'),
  rules: z.array(z.tuple([z.string().max(40), z.string().max(30), z.string().max(400)])).max(10).default([]),
});

export const PlanSchema = z.preprocess(fromWeekdayPlan, PlanObject.superRefine((plan, ctx) => {
  const check = (workouts: z.infer<typeof WorkoutSchema>[], path: (string | number)[]) => workouts.forEach((w, wi) => {
    const seen = new Set<string>();
    w.lifts.forEach((l, li) => {
      const s = slug(l.name);
      if (s === 'cardio' || s === 'end' || s === 'watch') ctx.addIssue({ code: 'custom', path: [...path, wi, 'lifts', li, 'name'], message: `"${l.name}" is a reserved name` });
      if (seen.has(s)) ctx.addIssue({ code: 'custom', path: [...path, wi, 'lifts', li, 'name'], message: `"${l.name}" appears twice in ${w.title}` });
      seen.add(s);
    });
  });
  check(plan.workouts, ['workouts']);
  plan.weeks.forEach((wk, i) => {
    if (wk.workouts) check(wk.workouts, ['weeks', i, 'workouts']);
    const n = (wk.workouts ?? plan.workouts).length;
    wk.skip.forEach((s, j) => { if (s >= n) ctx.addIssue({ code: 'custom', path: ['weeks', i, 'skip', j], message: `${wk.name} has no workout ${s}` }); });
  });
}));

export type Plan = z.infer<typeof PlanObject>;
export type Week = Plan['weeks'][number];
export type Workout = Plan['workouts'][number];
export type Lift = Workout['lifts'][number];

/* ---------- plans written before calendar weeks ---------- */

// Older plans had seven weekdays ("days", some of them rest days) shared by
// every week. Training days become workouts; rest days become offDays.
function fromWeekdayPlan(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { days?: unknown }).days) || 'workouts' in raw) return raw;
  const { days, ...rest } = raw as { days: Record<string, unknown>[] } & Record<string, unknown>;
  const offDays: Record<string, unknown>[] = [];
  for (const d of days.filter(d => d.rest)) {
    const sig = JSON.stringify([d.title, d.items ?? []]);
    if (!offDays.some(o => JSON.stringify([o.title, o.items ?? []]) === sig)) offDays.push({ title: d.title, focus: d.focus ?? '', items: d.items ?? [] });
  }
  return { ...rest, workouts: days.filter(d => !d.rest).map(({ d, rest: _, ...w }) => w), offDays };
}

// Old day index -> new workout index (null for rest days), to move log keys.
export function weekdayToWorkout(raw: unknown): (number | null)[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { days?: unknown }).days) || 'workouts' in raw) return null;
  let n = 0;
  return ((raw as { days: { rest?: boolean }[] }).days).map(d => d.rest ? null : n++);
}

/* ---------- weeks and workouts ---------- */

export function workoutsFor(plan: Plan, week: number): Workout[] {
  return plan.weeks[week]?.workouts ?? plan.workouts;
}

export function isSkipped(plan: Plan, week: number, workout: number): boolean {
  return !!plan.weeks[week]?.skip.includes(workout);
}

export function setsFor(lift: Lift, wk: Week): number {
  return Math.max(1, Math.round((lift.sets + (lift.main ? wk.extraSets : 0)) * wk.setScale));
}

const DAY_MS = 86400000;
function localMidnight(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// Monday of the week the block started in (local time).
export function blockMonday(startedAt: string): Date {
  const d = localMidnight(new Date(startedAt));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

// Which calendar week of the block a date falls in (0 = the first week). Can
// be past the plan's last week once the block has run its course.
export function weekIndexAt(startedAt: string, at: Date = new Date()): number {
  return Math.max(0, Math.floor(Math.round((localMidnight(at).getTime() - blockMonday(startedAt).getTime()) / DAY_MS) / 7));
}

export function weekStartDate(startedAt: string, week: number): string {
  const m = blockMonday(startedAt);
  return isoDate(new Date(m.getFullYear(), m.getMonth(), m.getDate() + week * 7));
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The start date that makes `week` the current calendar week (keeps the weekday).
export function startForWeek(startedAt: string, week: number, at: Date = new Date()): string {
  const shift = weekIndexAt(startedAt, at) - week;
  const s = new Date(startedAt);
  return new Date(s.getTime() + shift * 7 * DAY_MS).toISOString();
}

/* ---------- supersets ---------- */

// "A1" and "A2" form superset "A".
export function groupOf(lift: { pair?: string }): string | null {
  return lift.pair ? lift.pair[0].toUpperCase() : null;
}

/* ---------- goals and building up ---------- */

type DoneSet = { kg?: string; reps?: string; fail?: boolean };

export function repRange(reps: string): { lo: number; hi: number; timed: boolean } | null {
  const m = reps.match(/(\d+)\s*(?:[–—-]\s*(\d+))?/);
  if (!m) return null;
  const lo = +m[1], hi = m[2] ? +m[2] : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), timed: /\d\s*s\b|sec/i.test(reps) };
}

export function progressMode(lift: Lift, load?: string): 'load' | 'reps' | 'none' {
  if (lift.progress) return lift.progress;
  return load === 'bodyweight' || load === 'time' || load === 'band' ? 'reps' : 'load';
}

export function loadStep(lift: Lift, load?: string): number {
  if (lift.step) return lift.step;
  return load === 'dumbbell' ? 2 : load === 'machine' ? 5 : load === 'single' ? 2 : 2.5;
}

const num = (s?: string) => { const n = parseFloat(s ?? ''); return Number.isFinite(n) ? n : null; };
const fmtKg = (n: number) => String(Math.round(n * 100) / 100);

export function goalText(goal: NonNullable<Lift['goal']>): string {
  return `${goal.sets > 1 ? goal.sets + ' × ' : ''}${goal.kg !== undefined ? fmtKg(goal.kg) + ' kg × ' : ''}${goal.reps}`;
}

// How many sets of a session met the goal (kg and reps), against how many it needs.
export function goalSets(goal: NonNullable<Lift['goal']>, sets: DoneSet[]): number {
  return sets.filter(s => (num(s.reps) ?? 0) >= goal.reps && (goal.kg === undefined || (num(s.kg) ?? 0) >= goal.kg)).length;
}

// The next session's weight and reps from the last time this exercise was
// done (in any week). Double progression: stay at a weight until every set
// reaches the top of the rep range, then add a step and start at the bottom.
export function suggestNext(lift: Lift, load: string | undefined, last: DoneSet[] | null, wk: Week): { kg: string; reps: string; why: string } {
  const range = repRange(lift.reps);
  const startReps = range ? String(range.lo) : '';
  const sets = (last ?? []).filter(s => s.reps);
  if (!sets.length) return { kg: '', reps: startReps, why: '' };
  const kg = sets.find(s => s.kg)?.kg ?? '';
  const repsDone = sets.map(s => num(s.reps) ?? 0);
  if (!range) return { kg, reps: String(Math.min(...repsDone)), why: 'Same as last time' };
  if (wk.setScale < 1 || wk.cardio === 'deload') return { kg, reps: startReps, why: 'Recovery week: same weight, easy reps' };
  const mode = progressMode(lift, load);
  if (mode === 'none') return { kg, reps: String(Math.min(...repsDone)), why: 'Same as last time' };
  const inc = range.timed ? 5 : 1;
  if (mode === 'reps') {
    const cap = lift.goal?.reps ?? Infinity;
    const next = Math.min(cap, Math.max(range.lo, Math.min(...repsDone) + inc));
    return { kg, reps: String(next), why: next > Math.min(...repsDone) ? `Add ${inc === 5 ? '5 s' : 'a rep'}` : 'Hold it there' };
  }
  const kgN = num(kg);
  if (kgN !== null && repsDone.every(r => r >= range.hi) && !sets.some(s => s.fail)) {
    const step = loadStep(lift, load);
    return { kg: fmtKg(kgN + step), reps: startReps, why: `Every set reached ${range.hi}: add ${fmtKg(step)} kg` };
  }
  const next = Math.min(range.hi, Math.max(range.lo, Math.min(...repsDone) + inc));
  return { kg, reps: String(next), why: `Same weight, aim for ${next}` };
}

/* ---------- log keys ---------- */

// Log keys are "<week>-<workout>-<exercise slug>", plus "-cardio", "-end" and
// "-watch" (the Garmin activity's heart rate and calories), so reordering or
// swapping exercises never mixes up logged history. <workout> is the position
// in that week's workout list.
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
  const workout = workoutsFor(plan, k.week)[k.day];
  if (!workout) return null;
  const i = +k.item;
  if (i === workout.lifts.length) return `${k.week}-${k.day}-cardio`;
  const lift = workout.lifts[i];
  return lift ? `${k.week}-${k.day}-${slug(lift.name)}` : null;
}

export function formatIssues(err: z.ZodError): string {
  return err.issues.slice(0, 12).map(i => `${i.path.join('.') || '(plan)'}: ${i.message}`).join('\n');
}
