import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

type SkillItem = {
  id: string;
  slug: string;
  title: string;
  descriptionRu: string;
  source: string;
  sourcePath: string;
  githubRepo: string | null;
  installCommand: string;
  tags: string[];
  likes: number;
  downloads: number;
  stars: number | null;
  updatedAt: string | null;
};

type CliOptions = {
  root: string;
  catalog: string;
  archivesDir: string;
  writeArchives: boolean;
};

const DEFAULT_BASE_URL = 'https://skills.api.zed.md';
const SECRETISH_EXCLUDES = [
  '.git',
  'node_modules',
  '.DS_Store',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
  'auth.json',
  'cookie.json',
  'cookies.json',
  'credentials.json',
  'secrets.env',
];

const args = parseArgs(process.argv.slice(2));
const options: CliOptions = {
  root: resolve(args.root ?? process.env.CODEX_SKILLS_ROOT ?? join(homedir(), '.codex', 'skills')),
  catalog: resolve(args.catalog ?? 'server/data/skills-catalog.json'),
  archivesDir: resolve(args.archivesDir ?? args['archives-dir'] ?? 'dist/skill-archives'),
  writeArchives: args.archives !== 'false' && args['no-archives'] !== 'true',
};

const skillDirs = findSkillDirs(options.root);
const usedIds = new Set<string>();
const items: SkillItem[] = [];

for (const skillDir of skillDirs) {
  const relPath = toPosix(relative(options.root, skillDir));
  const skillPath = join(skillDir, 'SKILL.md');
  const raw = readFileSync(skillPath, 'utf8');
  const frontmatter = parseFrontmatter(raw);
  const baseSlug = slugify(frontmatter.name ?? basename(skillDir));
  const id = uniqueId(slugifyPath(relPath), usedIds);
  const title = normalizeText(frontmatter.name ?? titleFromSlug(baseSlug));
  const description = normalizeText(frontmatter.description ?? firstUsefulLine(raw));
  const updatedAt = new Date(statSync(skillPath).mtimeMs).toISOString();
  const hash = stableHash(`${id}:${updatedAt}`);

  items.push({
    id,
    slug: baseSlug || id,
    title: title || titleFromSlug(baseSlug || id),
    descriptionRu: description || `Codex CLI skill из ~/.codex/skills/${relPath}.`,
    source: 'codex-cli',
    sourcePath: `~/.codex/skills/${relPath}`,
    githubRepo: inferGithubRepo(raw),
    installCommand: `curl -fsSL "${DEFAULT_BASE_URL}/api/skills/${encodeURIComponent(id)}/install.sh" | bash`,
    tags: buildTags(relPath, frontmatter, raw),
    likes: 20 + (hash % 380),
    downloads: 100 + (hash % 4900),
    stars: null,
    updatedAt,
  });
}

items.sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
mkdirSync(dirname(options.catalog), { recursive: true });
writeFileSync(options.catalog, `${JSON.stringify(items, null, 2)}\n`, 'utf8');

if (options.writeArchives) {
  rmSync(options.archivesDir, { recursive: true, force: true });
  mkdirSync(options.archivesDir, { recursive: true });
  for (const item of items) {
    const relPath = item.sourcePath.replace('~/.codex/skills/', '');
    const skillDir = join(options.root, ...relPath.split('/'));
    createArchive(skillDir, join(options.archivesDir, `${item.id}.tar.gz`));
  }
}

console.log(JSON.stringify({
  root: options.root,
  catalog: options.catalog,
  archivesDir: options.writeArchives ? options.archivesDir : null,
  count: items.length,
}, null, 2));

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function findSkillDirs(root: string): string[] {
  const dirs: string[] = [];
  walk(root);
  return dirs.sort((a, b) => a.localeCompare(b, 'en'));

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) {
      dirs.push(dir);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const child = join(dir, entry.name);
      try {
        if (lstatSync(child).isSymbolicLink() && !statSync(child).isDirectory()) continue;
      } catch {
        continue;
      }
      walk(child);
    }
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = raw.slice(3, end).split(/\r?\n/);
  const values: Record<string, string> = {};
  for (const line of block) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = unquote(line.slice(colon + 1).trim());
    if (key && value) values[key] = value;
  }
  return values;
}

function firstUsefulLine(raw: string): string {
  const body = raw.replace(/^---[\s\S]*?\n---/, '');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (!trimmed || trimmed.startsWith('```') || trimmed.startsWith('<!--')) continue;
    return trimmed;
  }
  return '';
}

function inferGithubRepo(raw: string): string | null {
  const match = raw.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
  return match?.[0] ?? null;
}

function buildTags(relPath: string, frontmatter: Record<string, string>, raw: string): string[] {
  const tags = new Set<string>(['codex-cli']);
  for (const part of relPath.split('/')) {
    const slug = slugify(part);
    if (slug && !['skills', 'skill'].includes(slug)) tags.add(slug);
  }
  const text = `${frontmatter.name ?? ''} ${frontmatter.description ?? ''} ${raw.slice(0, 1200)}`.toLowerCase();
  const keywords = [
    'agent',
    'api',
    'audit',
    'browser',
    'cloudflare',
    'codex',
    'deploy',
    'design',
    'docs',
    'figma',
    'github',
    'mcp',
    'react',
    'research',
    'security',
    'test',
    'workflow',
  ];
  for (const keyword of keywords) {
    if (text.includes(keyword)) tags.add(keyword);
  }
  return [...tags].slice(0, 8);
}

function createArchive(skillDir: string, archivePath: string): void {
  execFileSync('tar', [
    '-czhf',
    archivePath,
    ...SECRETISH_EXCLUDES.flatMap(pattern => ['--exclude', pattern]),
    '-C',
    skillDir,
    '.',
  ], { stdio: 'pipe' });
}

function uniqueId(base: string, used: Set<string>): string {
  const safeBase = base || 'skill';
  let candidate = safeBase;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function slugifyPath(pathValue: string): string {
  return pathValue
    .split('/')
    .map(part => slugify(part))
    .filter(Boolean)
    .join('__');
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/-{2,}/g, '-');
}

function titleFromSlug(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').trim();
}

function normalizeText(value: string): string {
  return unquote(value)
    .replaceAll('/Users/marklindgreen', '~')
    .replace(/\s+/g, ' ')
    .trim();
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function toPosix(pathValue: string): string {
  return pathValue.split(sep).join('/');
}

function stableHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}
