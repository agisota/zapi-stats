import { readFileSync } from 'node:fs';

export interface SkillItem {
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
}

export interface SkillItemWithCategory extends SkillItem {
  category: string;
}

const catalog = JSON.parse(
  readFileSync(new URL('../data/skills-catalog.json', import.meta.url), 'utf8'),
) as SkillItem[];

export function getRawSkillsCatalog(): SkillItem[] {
  return catalog;
}

export function getSkillsCatalog(): SkillItemWithCategory[] {
  return catalog.map(skill => ({ ...skill, category: categorizeSkill(skill) }));
}

export function categorizeSkill(skill: SkillItem): string {
  const haystack = `${skill.slug} ${skill.title} ${skill.descriptionRu} ${skill.tags.join(' ')} ${skill.source}`.toLowerCase();
  if (/cloudflare|wrangler|deploy|terraform|docker|compose|temporal|render|s3|minio|infra|github|gh-|ci|actions/.test(haystack)) return 'Инфраструктура и деплой';
  if (/web|frontend|react|next|components|tailwind|shadcn|gsap|accessibility|design|visual|ui|browser/.test(haystack)) return 'Веб и интерфейсы';
  if (/security|audit|vulnerability|pentest|fuzz|constant-time|scanner|sanitize|privacy/.test(haystack)) return 'Безопасность и аудит';
  if (/research|paper|deep-research|autoresearch|alpha|competitor|customer|search|review/.test(haystack)) return 'Исследования и анализ';
  if (/document|docx|slides|presentation|spreadsheet|sheet|calendar|drive|report|pdf|word/.test(haystack)) return 'Документы и офис';
  if (/agent|mcp|codex|claude|gemini|autopilot|ralph|team|workflow|orchestration|prompt|skill/.test(haystack)) return 'Агенты и workflow';
  if (/api|provider|stripe|supabase|postgres|sdk|package|integration|email|imap|smtp|discord|telegram/.test(haystack)) return 'Интеграции и API';
  if (/macos|swift|appkit|swiftui|xcode/.test(haystack)) return 'macOS';
  return 'Утилиты';
}
