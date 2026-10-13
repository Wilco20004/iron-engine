import crypto from 'crypto';
import { Request, Router } from 'express';
import { db, ProfileRow } from './db';
import { checkPin, currentProfile, endSession, hashPin, requireProfile, startSession } from './auth';
import { KEY_RE } from './plan';
import {
  blockEntries, blockPlan, connectorToken, currentBlock, deleteEntry, ensureBlock, getBlock, getTemplate,
  importEntries, library, listBlocks, listTemplates, putEntry, regenerateConnectorToken, startBlock,
} from './store';
import { regenerateWatchKey, watchKey } from './watch';

export const api = Router();

const publicProfile = (p: ProfileRow) => ({ id: p.id, name: p.name, programId: p.program_id, age: p.age, hasPin: !!p.pin_hash, notes: p.notes ?? '' });
const validPin = (pin: unknown) => pin === undefined || pin === '' || (typeof pin === 'string' && /^\d{4,8}$/.test(pin));
const validAge = (age: unknown) => age === undefined || age === null || age === '' || (Number.isInteger(+(age as string)) && +(age as string) >= 12 && +(age as string) <= 100);
const me = (res: { locals: Record<string, unknown> }) => res.locals.profile as ProfileRow;
const blockInfo = (b: { id: number; number: number; program_id: string; started_at: string; ended_at: string | null; plan: string }) =>
  ({ id: b.id, number: b.number, programId: b.program_id, name: JSON.parse(b.plan).name, startedAt: b.started_at, endedAt: b.ended_at });

api.get('/health', (_req, res) => res.json({ ok: true }));

api.get('/programs', (_req, res) => res.json(listTemplates().map(({ id, name, subtitle }) => ({ id, name, subtitle }))));

// Profile picker on the sign-in screen: names only.
api.get('/profiles', (_req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as ProfileRow[];
  res.json(rows.map(p => ({ id: p.id, name: p.name, hasPin: !!p.pin_hash })));
});

// The first profile can be created by anyone (first run); after that only a
// signed-in household member can add someone.
api.post('/profiles', (req, res) => {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  if (count > 0 && !currentProfile(req)) return res.status(401).json({ error: 'Sign in to add a person' });
  const { name, programId, age, pin } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 40) return res.status(400).json({ error: 'Enter a name (up to 40 characters)' });
  if (db.prepare('SELECT 1 FROM profiles WHERE lower(name) = lower(?)').get(name.trim())) return res.status(400).json({ error: 'Someone already has that name' });
  if (typeof programId !== 'string' || !getTemplate(programId)) return res.status(400).json({ error: 'Pick a program' });
  if (!validAge(age)) return res.status(400).json({ error: 'Age must be a whole number between 12 and 100' });
  if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO profiles (id, name, program_id, age, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), programId, age ? +age : null, pin ? hashPin(pin) : null, new Date().toISOString());
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow;
  ensureBlock(profile);
  if (count === 0) startSession(req, res, id);
  res.status(201).json(publicProfile(profile));
});

api.post('/login', (req, res) => {
  const { profileId, pin } = req.body ?? {};
  const p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as ProfileRow | undefined;
  if (!p) return res.status(404).json({ error: 'That person no longer exists' });
  if (p.pin_hash && (typeof pin !== 'string' || !checkPin(pin, p.pin_hash))) return res.status(401).json({ error: 'Wrong PIN. Try again.' });
  startSession(req, res, p.id);
  res.json(publicProfile(p));
});

api.post('/logout', (req, res) => { endSession(req, res); res.status(204).end(); });

api.get('/me', requireProfile, (_req, res) => res.json(publicProfile(me(res))));

api.patch('/me', requireProfile, (req, res) => {
  const p = me(res);
  const { age, pin, notes } = req.body ?? {};
  if (!validAge(age)) return res.status(400).json({ error: 'Age must be a whole number between 12 and 100' });
  if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' });
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 4000)) return res.status(400).json({ error: 'Notes are limited to 4000 characters' });
  if (age !== undefined) db.prepare('UPDATE profiles SET age = ? WHERE id = ?').run(age ? +age : null, p.id);
  if (pin !== undefined) db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(pin ? hashPin(pin) : null, p.id);
  if (notes !== undefined) db.prepare('UPDATE profiles SET notes = ? WHERE id = ?').run(notes, p.id);
  res.json(publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(p.id) as ProfileRow));
});

// The current block's plan, the exercise library, block history, and the
// previous block's log (for "last time" hints in a new block's first weeks).
api.get('/program', requireProfile, (_req, res) => {
  const p = me(res);
  const block = ensureBlock(p);
  const blocks = listBlocks(p.id);
  const prev = blocks.find(b => b.number === block.number - 1);
  res.json({
    program: blockPlan(block),
    exercises: library(),
    block: blockInfo(block),
    blocks: blocks.map(blockInfo),
    previous: prev ? { weeks: blockPlan(prev).weeks, days: blockPlan(prev).days.map(d => d.d), entries: blockEntries(p.id, prev.id) } : null,
  });
});

api.post('/blocks', requireProfile, (req, res) => {
  const { programId } = req.body ?? {};
  if (programId !== undefined && (typeof programId !== 'string' || !getTemplate(programId))) return res.status(400).json({ error: 'Pick a program' });
  const p = me(res);
  ensureBlock(p);
  res.status(201).json(blockInfo(startBlock(p, programId)));
});

api.get('/blocks/:number', requireProfile, (req, res) => {
  const p = me(res);
  const b = getBlock(p.id, +req.params.number);
  if (!b) return res.status(404).json({ error: 'No such block' });
  res.json({ block: blockInfo(b), plan: blockPlan(b), entries: blockEntries(p.id, b.id) });
});

api.get('/log', requireProfile, (_req, res) => {
  const p = me(res);
  res.json(blockEntries(p.id, ensureBlock(p).id));
});

api.put('/log/:key', requireProfile, (req, res) => {
  const { key } = req.params;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Bad log key' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Log entry must be an object' });
  const p = me(res);
  putEntry(p.id, ensureBlock(p).id, key, req.body);
  res.status(204).end();
});

api.delete('/log/:key', requireProfile, (req, res) => {
  const p = me(res);
  const b = currentBlock(p.id);
  if (b) deleteEntry(p.id, b.id, req.params.key);
  res.status(204).end();
});

// Bulk import into the current block, e.g. a log exported from the first
// version of the plan (position keys like "0-0-3" are converted).
api.post('/log/import', requireProfile, (req, res) => {
  const entries = req.body?.entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return res.status(400).json({ error: 'Expected { entries: { key: entry } }' });
  const p = me(res);
  res.json({ imported: importEntries(p.id, ensureBlock(p), entries) });
});

/* ---------- Garmin watch key ---------- */

api.get('/watch-key', requireProfile, (_req, res) => res.json({ key: watchKey(me(res).id) }));
api.post('/watch-key/regenerate', requireProfile, (_req, res) => res.json({ key: regenerateWatchKey(me(res).id) }));

/* ---------- connector (MCP) link ---------- */

function connectorUrl(req: Request, token: string) {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  return `${proto}://${host}/mcp/${token}`;
}

api.get('/connector', requireProfile, (req, res) => {
  res.json({ url: connectorUrl(req, connectorToken()) });
});

api.post('/connector/regenerate', requireProfile, (req, res) => {
  res.json({ url: connectorUrl(req, regenerateConnectorToken()) });
});
