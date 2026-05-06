import { Hono } from 'hono';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRawSkillsCatalog, getSkillsCatalog } from '../services/skills-catalog.ts';

type SkillAction = 'like' | 'download';

const catalog = getRawSkillsCatalog();

async function readState(): Promise<Record<string, { likes?: number; downloads?: number }>> {
  const stateDir = process.env.APP_STATE_DIR ?? '/data/zapi-stats-state';
  try {
    const raw = await readFile(join(stateDir, 'skills-state.json'), 'utf8');
    return JSON.parse(raw) as Record<string, { likes?: number; downloads?: number }>;
  } catch {
    return {};
  }
}

async function writeState(state: Record<string, { likes?: number; downloads?: number }>): Promise<void> {
  const stateDir = process.env.APP_STATE_DIR ?? '/data/zapi-stats-state';
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'skills-state.json'), JSON.stringify(state, null, 2));
}

export function skillsRoutes() {
  const app = new Hono();

  app.get('/skills', async (c) => {
    const q = (c.req.query('q') ?? '').trim().toLowerCase();
    const source = (c.req.query('source') ?? '').trim();
    const category = (c.req.query('category') ?? '').trim();
    const state = await readState();
    const withState = getSkillsCatalog().map(skill => ({
      ...skill,
      likes: state[skill.id]?.likes ?? skill.likes,
      downloads: state[skill.id]?.downloads ?? skill.downloads,
    }));
    const items = withState.filter(skill => {
      if (source && skill.source !== source) return false;
      if (category && skill.category !== category) return false;
      if (!q) return true;
      return `${skill.slug} ${skill.title} ${skill.descriptionRu} ${skill.category} ${skill.tags.join(' ')}`.toLowerCase().includes(q);
    });

    return c.json({
      data: {
        total: catalog.length,
        returned: items.length,
        items,
        sources: [...new Set(catalog.map(skill => skill.source))].sort(),
        categories: [...new Set(withState.map(skill => skill.category))].sort(),
      },
    });
  });

  app.post('/skills/:id/:action', async (c) => {
    const id = c.req.param('id');
    const action = c.req.param('action') as SkillAction;
    if (action !== 'like' && action !== 'download') {
      return c.json({ error: { code: 'BAD_ACTION', message: 'Unsupported skill action' } }, 400);
    }

    const skill = catalog.find(item => item.id === id);
    if (!skill) return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);

    const state = await readState();
    const current = state[id] ?? { likes: skill.likes, downloads: skill.downloads };
    current[action === 'like' ? 'likes' : 'downloads'] = (current[action === 'like' ? 'likes' : 'downloads'] ?? 0) + 1;
    state[id] = current;
    await writeState(state);

    return c.json({ data: { id, likes: current.likes ?? skill.likes, downloads: current.downloads ?? skill.downloads } });
  });

  return app;
}
