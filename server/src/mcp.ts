import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { BlockRow, db, ProfileRow } from './db';
import { LiftSchema, Plan, WorkoutSchema, formatIssues, goalText, parseKey, setsFor, slug, startForWeek, weekStartDate, workoutsFor } from './plan';
import {
  blockEntries, blockPlan, connectorToken, currentBlock, currentWeek, ensureBlock, findProfile, getBlock, getTemplate,
  library, listBlocks, listProfiles, listTemplates, progress, readableLog, saveTemplate, setBlockPlan,
  startBlock, upsertExercise, validatePlan, weekStatus,
} from './store';

// A remote MCP server (streamable HTTP, stateless) so Claude can read logs and
// change training plans directly. Mounted at /mcp/<token>; the token is shown
// in the app's settings.

const INSTRUCTIONS = `Iron + Engine is a household training app. Each person has a profile, a current
training block (a plan run over a few calendar weeks) and a log of what they did.

How plans work:
- A block runs in calendar weeks, Monday to Sunday, from the day it started. Each week sets the effort
  (RIR = reps in reserve, sets, deload) and is a checklist of workouts done on any day, in any order.
  Missed days don't move anything: the week just has fewer workouts done.
- plan.workouts is the default list for every week. A week can have its own list (weeks[n].workouts)
  or skip workouts (weeks[n].skip), without affecting other weeks.
- Exercises can have a goal (e.g. 3 x 10 strict pull-ups) and build up by load (double progression
  through the rep range) or by reps. The app suggests next time's weight and reps from the last log.
- Lifts with pair "A1" and "A2" are a superset: done back to back, resting after A2.

Conventions:
- Every session is weights first, then cardio.
- Barbell weights are logged as the TOTAL on the bar (20 kg bar included). Dumbbell weights are per dumbbell.
- "fail: true" on a set means it was taken to failure.
- Read a person's coaching notes (list_people) before advising them; they hold injuries and decisions.

Changing plans: make the smallest change that does the job.
- Schedule problems (a holiday, a missed day, a busy week): get_week, then skip_workout or
  update_workout with a week. Never rebuild the whole plan for this.
- One exercise (sets, reps, goal, how it builds up), everywhere or in one week: update_exercise.
- One workout, everywhere or in one week: update_workout.
- The block's weeks are off (a week lost to illness): set_current_week.
- update_plan replaces the whole plan; use it only for a real redesign. It refuses changes that would
  move workouts that already have logs; skip them instead.
- Tell the person what you are about to change before changing it.
- Record important decisions with update_person (notes), so future conversations know them.`;

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true as const });

function findWorkout(plan: Plan, week: number, w: number | string): number {
  const list = workoutsFor(plan, week);
  const i = typeof w === 'number' ? w : list.findIndex(x => x.title.toLowerCase() === w.trim().toLowerCase());
  if (!list[i]) throw new Error(`No workout "${w}" in week ${week + 1}. It has: ${list.map((x, n) => `${n} ${x.title}`).join(', ')}`);
  return i;
}

// A week's own workout list, copied from the plan's the first time a single
// week is changed.
function weekList(plan: Plan, week: number) {
  const wk = plan.weeks[week];
  if (!wk) throw new Error(`The block has ${plan.weeks.length} weeks`);
  wk.workouts ??= structuredClone(plan.workouts);
  return wk.workouts;
}

function checked(plan: Plan): Plan {
  const v = validatePlan(plan);
  if (!v.ok) throw new Error(`Not saved. Fix these and try again:\n${v.error}`);
  return v.plan;
}

// Saves a block's plan unless it would change which workout already-logged
// sets belong to (log keys hold the workout's position in its week).
function savePlan(p: ProfileRow, b: BlockRow, plan: Plan) {
  const before = blockPlan(b);
  const moved = new Set<string>();
  for (const key of Object.keys(blockEntries(p.id, b.id))) {
    const k = parseKey(key);
    if (!k) continue;
    const was = workoutsFor(before, k.week)[k.day]?.title, now = workoutsFor(plan, k.week)[k.day]?.title;
    if (was && was !== now) moved.add(`week ${k.week + 1}: ${was} (position ${k.day}) would become ${now ?? 'nothing'}`);
  }
  if (moved.size) throw new Error(`Not saved: these workouts already have logs and would move:\n${[...moved].join('\n')}\n` +
    'Keep them in place (skip them with skip_workout, or add new workouts at the end).');
  setBlockPlan(b.id, plan);
  const names = (pl: Plan) => new Set([pl.workouts, ...pl.weeks.map(w => w.workouts ?? [])].flat().flatMap(w => w.lifts.map(l => l.name)));
  const was = names(before), now = names(plan);
  const lib = library();
  return {
    saved: true, person: p.name, block: b.number,
    added: [...now].filter(n => !was.has(n)), removed: [...was].filter(n => !now.has(n)),
    notInLibrary: [...now].filter(n => !lib[n]).map(n => `${n} (no photo or how-to; add with upsert_exercise)`),
  };
}

function person(who: string): ProfileRow {
  const p = findProfile(who);
  if (!p) throw new Error(`No person called "${who}". People: ${listProfiles().map(x => x.name).join(', ') || 'none yet'}`);
  return p;
}

function safe<A>(fn: (args: A) => unknown) {
  return async (args: A) => {
    try { return text(await fn(args)); }
    catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  };
}

const Person = z.string().min(1).describe('Person\'s name as shown in the app (case-insensitive), or their id.');

function buildServer() {
  const server = new McpServer({ name: 'iron-engine', version: '1.1.0' }, { instructions: INSTRUCTIONS });
  // The SDK's generic registerTool signature is very slow for TypeScript to
  // check against zod shapes; arguments are validated at runtime either way.
  type ToolConfig = { title: string; description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations?: Record<string, boolean> };
  const tool = server.registerTool.bind(server) as unknown as (name: string, config: ToolConfig, cb: (args: any) => unknown) => void;

  tool('list_people', {
    title: 'List people',
    description: 'Everyone with a profile: age, coaching notes, current block and program. Start here.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => listProfiles().map(p => {
    const b = ensureBlock(p);
    const plan = blockPlan(b);
    return {
      name: p.name, id: p.id, age: p.age, notes: p.notes || '',
      currentBlock: { number: b.number, program: plan.name, programId: b.program_id, startedAt: b.started_at, weeks: plan.weeks.length },
      blocksSoFar: listBlocks(p.id).length,
      nextBlockProgramId: p.program_id,
    };
  })));

  tool('get_plan', {
    title: 'Get current plan',
    description: 'The full plan JSON a person is following in their current block (or an earlier block). Edit it and pass it back to update_plan.',
    inputSchema: { person: Person, block: z.number().int().min(1).optional().describe('Block number; defaults to the current block.') },
    annotations: { readOnlyHint: true },
  }, safe(({ person: who, block }: { person: string; block?: number }) => {
    const p = person(who);
    const b = block ? getBlock(p.id, block) : ensureBlock(p);
    if (!b) throw new Error(`${p.name} has no block ${block}`);
    return { block: { number: b.number, startedAt: b.started_at, endedAt: b.ended_at, current: b.id === currentBlock(p.id)?.id }, plan: blockPlan(b) };
  }));

  tool('update_plan', {
    title: 'Update a person\'s plan',
    description: 'Replace the plan for a person\'s CURRENT block with the given plan JSON (same shape as get_plan returns). ' +
      'The app shows the change straight away. Set also_update_template to also save it as the program template, so future blocks start from it. ' +
      'Returns validation errors if the plan is malformed.',
    inputSchema: {
      person: Person,
      plan: z.object({}).passthrough().describe('The complete plan object.'),
      also_update_template: z.boolean().default(false).describe('Also save as the template with the plan\'s id (used when the next block starts).'),
    },
  }, safe(({ person: who, plan, also_update_template }: { person: string; plan: unknown; also_update_template: boolean }) => {
    const p = person(who);
    const v = validatePlan(plan);
    if (!v.ok) throw new Error(`The plan was not saved. Fix these and try again:\n${v.error}`);
    const b = ensureBlock(p);
    const r = savePlan(p, b, v.plan);
    if (also_update_template) {
      saveTemplate(v.plan);
      db.prepare('UPDATE profiles SET program_id = ? WHERE id = ?').run(v.plan.id, p.id);
    }
    return { ...r, templateUpdated: also_update_template };
  }));

  tool('get_week', {
    title: 'Get a week',
    description: 'One calendar week of a person\'s current block: its dates, effort, and each workout with its status ' +
      '(done, started, todo, skipped, missed) and exercises. Defaults to this week. Use before changing a week.',
    inputSchema: { person: Person, week: z.number().int().min(1).optional().describe('Week number (1 = the block\'s first week); defaults to this week.') },
    annotations: { readOnlyHint: true },
  }, safe(({ person: who, week }: { person: string; week?: number }) => {
    const p = person(who);
    const b = ensureBlock(p);
    const plan = blockPlan(b);
    const now = currentWeek(b, plan);
    const w = week ? week - 1 : now.week;
    const wk = plan.weeks[w];
    if (!wk) throw new Error(`The block has ${plan.weeks.length} weeks`);
    const entries = blockEntries(p.id, b.id);
    const { workouts: _, ...effort } = wk;
    return {
      person: p.name, week: w + 1, of: plan.weeks.length, startsOn: weekStartDate(b.started_at, w),
      isThisWeek: w === now.week && !now.finished, blockFinished: now.finished,
      ownWorkoutList: !!wk.workouts, effort,
      workouts: weekStatus(b, plan, entries, w).map(s => {
        const wo = workoutsFor(plan, w)[s.index];
        return { position: s.index, title: s.title, status: s.status, exercises: wo.lifts.map(l => `${l.pair ? l.pair + ' ' : ''}${l.name}: ${setsFor(l, wk)} x ${l.reps}`) };
      }),
      offDays: plan.offDays.map(o => o.title),
    };
  }));

  tool('skip_workout', {
    title: 'Skip a workout this week',
    description: 'Mark a workout as skipped (or not) in one week only, e.g. for a holiday or a lost day. Other weeks are untouched. ' +
      'Logged sets are kept.',
    inputSchema: {
      person: Person,
      workout: z.union([z.number().int().min(0), z.string()]).describe('Workout position (from get_week) or title.'),
      week: z.number().int().min(1).optional().describe('Week number; defaults to this week.'),
      skip: z.boolean().default(true).describe('false un-skips it.'),
    },
  }, safe(({ person: who, workout, week, skip }: { person: string; workout: number | string; week?: number; skip: boolean }) => {
    const p = person(who);
    const b = ensureBlock(p);
    const plan = blockPlan(b);
    const w = week ? week - 1 : currentWeek(b, plan).week;
    if (!plan.weeks[w]) throw new Error(`The block has ${plan.weeks.length} weeks`);
    const i = findWorkout(plan, w, workout);
    const list = new Set(plan.weeks[w].skip);
    if (skip) list.add(i); else list.delete(i);
    plan.weeks[w].skip = [...list].sort();
    setBlockPlan(b.id, checked(plan));
    return { saved: true, week: w + 1, workout: workoutsFor(plan, w)[i].title, skipped: skip };
  }));

  tool('update_workout', {
    title: 'Change a workout',
    description: 'Replace one workout (title, focus, minutes, lifts, cardio) with the given JSON, in every week or in one week only. ' +
      'With week, only that week changes (it gets its own copy of the workout list). position "new" adds a workout to that week (or to all weeks).',
    inputSchema: {
      person: Person,
      position: z.union([z.number().int().min(0), z.literal('new')]).describe('Workout position (from get_week), or "new".'),
      workout: z.object({}).passthrough().describe('The complete workout object (same shape as plan.workouts[n]).'),
      week: z.number().int().min(1).optional().describe('Only this week. Leave out to change the plan for every week that uses the plan\'s workouts.'),
    },
  }, safe(({ person: who, position, workout, week }: { person: string; position: number | 'new'; workout: unknown; week?: number }) => {
    const p = person(who);
    const b = ensureBlock(p);
    const plan = blockPlan(b);
    const parsed = WorkoutSchema.safeParse(workout);
    if (!parsed.success) throw new Error(`Not saved. Fix these and try again:\n${formatIssues(parsed.error)}`);
    const list = week ? weekList(plan, week - 1) : plan.workouts;
    if (position === 'new') list.push(parsed.data);
    else if (list[position]) list[position] = parsed.data;
    else throw new Error(`There is no workout ${position}; there are ${list.length}`);
    return savePlan(p, b, checked(plan));
  }));

  tool('update_exercise', {
    title: 'Change an exercise in the plan',
    description: 'Change one exercise wherever it appears (every week, or one week only): sets, reps, rest, cue, goal, how it builds up, ' +
      'caution, superset pair, or rename/swap it (a new name starts a new history line).',
    inputSchema: {
      person: Person,
      exercise: z.string().describe('Current exercise name in the plan.'),
      changes: LiftSchema.partial().describe('Only the fields to change. goal: null removes the goal.').passthrough(),
      week: z.number().int().min(1).optional().describe('Only this week. Leave out for every week.'),
    },
  }, safe(({ person: who, exercise, changes, week }: { person: string; exercise: string; changes: Record<string, unknown>; week?: number }) => {
    const p = person(who);
    const b = ensureBlock(p);
    const plan = blockPlan(b);
    const lists = week ? [weekList(plan, week - 1)] : [plan.workouts, ...plan.weeks.filter(wk => wk.workouts).map(wk => wk.workouts!)];
    let n = 0;
    for (const list of lists) for (const wo of list) {
      wo.lifts = wo.lifts.map(l => {
        if (slug(l.name) !== slug(exercise)) return l;
        n++;
        const next: Record<string, unknown> = { ...l, ...changes };
        for (const [k, val] of Object.entries(changes)) if (val === null) delete next[k];
        return next as typeof l;
      });
    }
    if (!n) throw new Error(`"${exercise}" isn't in ${week ? `week ${week}` : 'the plan'}`);
    return { ...savePlan(p, b, checked(plan)), changedIn: n };
  }));

  tool('set_current_week', {
    title: 'Set which week it is',
    description: 'Move the block\'s dates so that the given week is this calendar week, e.g. after a week off sick (repeat a week) ' +
      'or to skip ahead. Logs stay with their weeks.',
    inputSchema: { person: Person, week: z.number().int().min(1).describe('The week number that should be this week.') },
  }, safe(({ person: who, week }: { person: string; week: number }) => {
    const p = person(who);
    const b = ensureBlock(p);
    const plan = blockPlan(b);
    if (!plan.weeks[week - 1]) throw new Error(`The block has ${plan.weeks.length} weeks`);
    const start = startForWeek(b.started_at, week - 1);
    db.prepare('UPDATE blocks SET started_at = ? WHERE id = ?').run(start, b.id);
    return { saved: true, person: p.name, thisWeek: week, blockStartedAt: start, weekStartsOn: weekStartDate(start, week - 1) };
  }));

  tool('get_log', {
    title: 'Get training log',
    description: 'What a person logged in a block: sets (kg × reps, failure marks), cardio and early endings, in order. kg for barbells is the total on the bar.',
    inputSchema: { person: Person, block: z.number().int().min(1).optional().describe('Block number; defaults to the current block.') },
    annotations: { readOnlyHint: true },
  }, safe(({ person: who, block }: { person: string; block?: number }) => {
    const p = person(who);
    const b = block ? getBlock(p.id, block) : ensureBlock(p);
    if (!b) throw new Error(`${p.name} has no block ${block}`);
    const plan = blockPlan(b);
    return { person: p.name, block: b.number, program: plan.name, startedAt: b.started_at, log: readableLog(plan, blockEntries(p.id, b.id)) };
  }));

  tool('get_progress', {
    title: 'Get progress',
    description: 'Per exercise, across all blocks: the best set each week, estimated 1-rep max, volume and failure sets, plus the goals set in the current plan. Optionally one exercise.',
    inputSchema: { person: Person, exercise: z.string().optional().describe('Exercise name to limit to, e.g. "Barbell bench press".') },
    annotations: { readOnlyHint: true },
  }, safe(({ person: who, exercise }: { person: string; exercise?: string }) => {
    const p = person(who);
    const plan = blockPlan(ensureBlock(p));
    const goals = [...new Map([plan.workouts, ...plan.weeks.map(w => w.workouts ?? [])].flat().flatMap(w => w.lifts)
      .filter(l => l.goal && (!exercise || slug(l.name) === slug(exercise))).map(l => [l.name, { exercise: l.name, goal: goalText(l.goal!), note: l.goal!.note }])).values()];
    return { person: p.name, goals, progress: progress(p.id, exercise) };
  }));

  tool('start_new_block', {
    title: 'Start a new block',
    description: 'End the person\'s current block and start the next one from a program template (default: their next-block template). ' +
      'Earlier blocks and their logs are kept. Edit the new block afterwards with update_plan, e.g. to raise weights or change exercises.',
    inputSchema: { person: Person, program_id: z.string().optional().describe('Template id from list_program_templates.') },
  }, safe(({ person: who, program_id }: { person: string; program_id?: string }) => {
    const p = person(who);
    ensureBlock(p);
    const b = startBlock(p, program_id);
    return { started: true, person: p.name, block: b.number, program: blockPlan(b).name };
  }));

  tool('list_program_templates', {
    title: 'List program templates',
    description: 'Program templates a new block can start from.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(() => listTemplates()));

  tool('get_program_template', {
    title: 'Get a program template',
    description: 'A template\'s full plan JSON.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  }, safe(({ id }: { id: string }) => {
    const t = getTemplate(id);
    if (!t) throw new Error(`No template "${id}"`);
    return t;
  }));

  tool('save_program_template', {
    title: 'Save a program template',
    description: 'Create a new template or update one (matched by plan.id). Doesn\'t change anyone\'s current block.',
    inputSchema: { plan: z.object({}).passthrough().describe('The complete plan object; its id names the template.') },
  }, safe(({ plan }: { plan: unknown }) => {
    const v = validatePlan(plan);
    if (!v.ok) throw new Error(`The template was not saved. Fix these and try again:\n${v.error}`);
    saveTemplate(v.plan);
    return { saved: true, id: v.plan.id };
  }));

  tool('get_exercise_library', {
    title: 'Get exercise library',
    description: 'Exercises with how-to text, muscles, load type and cautions. Exercise names in a plan should match these to show photos and steps.',
    inputSchema: { names: z.array(z.string()).optional().describe('Only these exercises; omit for the list of all names.') },
    annotations: { readOnlyHint: true },
  }, safe(({ names }: { names?: string[] }) => {
    const lib = library();
    if (!names?.length) return Object.entries(lib).map(([n, e]) => ({ name: n, load: e.load, hasPhotos: (e.images as number) > 0, caution: e.caution }));
    return Object.fromEntries(names.map(n => [n, lib[n] ?? null]));
  }));

  tool('upsert_exercise', {
    title: 'Add or change an exercise',
    description: 'Add an exercise to the library (or change one) so the app shows how-to steps for it. New exercises have no photos.',
    inputSchema: {
      name: z.string().min(1).max(80),
      what: z.string().max(300).describe('One or two plain sentences: what it is and what it builds.'),
      steps: z.array(z.string().max(200)).min(1).max(6),
      load: z.enum(['barbell', 'ezbar', 'dumbbell', 'single', 'machine', 'added', 'bodyweight', 'time', 'band']).describe('What the kg box means.'),
      muscles: z.array(z.string()).max(4).optional(),
      caution: z.string().max(400).optional(),
    },
  }, safe((args: { name: string; what: string; steps: string[]; load: string; muscles?: string[]; caution?: string }) => {
    const existing = library()[args.name];
    upsertExercise(args.name, { ...(existing ?? { photo: '', images: 0, secondary: [] }), ...args });
    return { saved: true, name: args.name, new: !existing };
  }));

  tool('update_person', {
    title: 'Update a person',
    description: 'Change a person\'s age, coaching notes (replaces them; include what should be kept) or the template their next block starts from.',
    inputSchema: {
      person: Person,
      age: z.number().int().min(12).max(100).optional(),
      notes: z.string().max(4000).optional().describe('Coaching notes: injuries, goals, decisions, preferences.'),
      next_program_id: z.string().optional(),
    },
  }, safe(({ person: who, age, notes, next_program_id }: { person: string; age?: number; notes?: string; next_program_id?: string }) => {
    const p = person(who);
    if (next_program_id && !getTemplate(next_program_id)) throw new Error(`No template "${next_program_id}"`);
    if (age !== undefined) db.prepare('UPDATE profiles SET age = ? WHERE id = ?').run(age, p.id);
    if (notes !== undefined) db.prepare('UPDATE profiles SET notes = ? WHERE id = ?').run(notes, p.id);
    if (next_program_id) db.prepare('UPDATE profiles SET program_id = ? WHERE id = ?').run(next_program_id, p.id);
    return { saved: true, person: p.name };
  }));

  return server;
}

function authorized(req: Request): boolean {
  const supplied = req.params.token || (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const expected = connectorToken();
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: Request, res: Response) {
  if (!authorized(req)) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid connector link' }, id: null });
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export const mcp = Router();
const notAllowed = (_req: Request, res: Response) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
mcp.post(['/', '/:token'], (req, res) => { handle(req, res).catch(e => { console.error(e); if (!res.headersSent) res.status(500).end(); }); });
mcp.get(['/', '/:token'], notAllowed);
mcp.delete(['/', '/:token'], notAllowed);

