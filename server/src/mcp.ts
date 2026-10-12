import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { db, ProfileRow } from './db';
import { slug } from './plan';
import {
  blockEntries, blockPlan, connectorToken, currentBlock, ensureBlock, findProfile, getBlock, getTemplate,
  library, listBlocks, listProfiles, listTemplates, progress, readableLog, saveTemplate, setBlockPlan,
  startBlock, upsertExercise, validatePlan,
} from './store';

// A remote MCP server (streamable HTTP, stateless) so Claude can read logs and
// change training plans directly. Mounted at /mcp/<token>; the token is shown
// in the app's settings.

const INSTRUCTIONS = `Iron + Engine is a household training app. Each person has a profile, a current
training block (one run through a plan, usually 4 weeks) and a log of what they did.

Conventions:
- Every session is weights first, then cardio. Weeks set the effort with RIR (reps in reserve).
- Barbell weights are logged as the TOTAL on the bar (20 kg bar included). Dumbbell weights are per dumbbell.
- "fail: true" on a set means it was taken to failure.
- Read a person's coaching notes (list_people) before advising them; they hold injuries and decisions.

Changing plans:
- Use get_plan, edit the JSON, then update_plan with the whole plan. Edits to the current block show
  in the app immediately. Logged history is keyed by exercise name, so reordering is safe; renaming or
  swapping an exercise starts a fresh history line for the new name.
- Tell the person what you are about to change before calling update_plan or start_new_block.
- Record important decisions with update_person (notes), so future conversations know them.`;

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true as const });

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
    const before = blockPlan(b);
    setBlockPlan(b.id, v.plan);
    if (also_update_template) {
      saveTemplate(v.plan);
      db.prepare('UPDATE profiles SET program_id = ? WHERE id = ?').run(v.plan.id, p.id);
    }
    const names = (pl: typeof before) => new Set(pl.days.flatMap(d => 'lifts' in d ? d.lifts.map(l => l.name) : []));
    const was = names(before), now = names(v.plan);
    const lib = library();
    return {
      saved: true, person: p.name, block: b.number, templateUpdated: also_update_template,
      added: [...now].filter(n => !was.has(n)), removed: [...was].filter(n => !now.has(n)),
      notInLibrary: [...now].filter(n => !lib[n]).map(n => `${n} (no photo or how-to; add with upsert_exercise)`),
    };
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
    description: 'Per exercise, across all blocks: the best set each week, estimated 1-rep max, volume and failure sets. Optionally one exercise.',
    inputSchema: { person: Person, exercise: z.string().optional().describe('Exercise name to limit to, e.g. "Barbell bench press".') },
    annotations: { readOnlyHint: true },
  }, safe(({ person: who, exercise }: { person: string; exercise?: string }) => {
    const p = person(who);
    return { person: p.name, progress: progress(p.id, exercise) };
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

