import fs from 'fs';
import path from 'path';

// Programs and the shared exercise library are plain JSON files, so a new
// program for a new person is a new file in programs/.
const PROGRAMS_DIR = process.env.IRON_PROGRAMS_DIR || path.join(__dirname, '..', 'programs');

type Program = { id: string; name: string; subtitle?: string; [k: string]: unknown };

let cache: { programs: Map<string, Program>; exercises: Record<string, unknown> } | null = null;

function load() {
  if (cache) return cache;
  const programs = new Map<string, Program>();
  let exercises: Record<string, unknown> = {};
  for (const file of fs.readdirSync(PROGRAMS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(fs.readFileSync(path.join(PROGRAMS_DIR, file), 'utf8'));
    if (file === 'exercises.json') exercises = json;
    else programs.set(json.id, json);
  }
  cache = { programs, exercises };
  return cache;
}

export function listPrograms() {
  return [...load().programs.values()].map(p => ({ id: p.id, name: p.name, subtitle: p.subtitle ?? '' }));
}

export function getProgram(id: string): Program | undefined {
  return load().programs.get(id);
}

export function getExercises() {
  return load().exercises;
}
