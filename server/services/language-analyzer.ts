import type { Database } from 'bun:sqlite';
import { ArtifactReader, collectPromptTexts } from './artifact-reader.ts';

export interface LanguageStats {
  englishPercent: number;
  russianPercent: number;
  otherPercent: number;
  sampledMessages: number;
  dominantLanguage: 'en' | 'ru' | 'mixed';
}

const CYRILLIC_RE = /[\u0400-\u04FF]/g;
const LATIN_RE = /[a-zA-Z]/g;

function detectLanguage(text: string): { en: number; ru: number; other: number } {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[{}()[\]<>/\\|@#$%^&*=+_~;:'",.!?\d\s-]/g, '');

  if (cleaned.length < 5) return { en: 0, ru: 0, other: 0 };

  const cyrillicCount = (cleaned.match(CYRILLIC_RE) ?? []).length;
  const latinCount = (cleaned.match(LATIN_RE) ?? []).length;
  const total = cyrillicCount + latinCount;

  if (total === 0) return { en: 0, ru: 0, other: cleaned.length };

  return {
    en: latinCount,
    ru: cyrillicCount,
    other: cleaned.length - total,
  };
}

export class LanguageAnalyzer {
  private artifactReader: ArtifactReader;
  private cache = new Map<string, { data: LanguageStats; expiry: number }>();

  constructor(db: Database, logsPath?: string) {
    this.artifactReader = new ArtifactReader(db, logsPath);
  }

  async getUserLanguageStats(apiKeyName: string, sampleSize = 160): Promise<LanguageStats> {
    const cached = this.cache.get(apiKeyName);
    if (cached && cached.expiry > Date.now()) return cached.data;

    let totalEn = 0;
    let totalRu = 0;
    let totalOther = 0;
    let sampledMessages = 0;
    let sampledRequests = 0;

    const records = await this.artifactReader.getUserArtifacts(apiKeyName, sampleSize);
    for (const record of records) {
      sampledRequests++;
      const texts = collectPromptTexts(record.payload, record.row.requestSummary);
      for (const text of texts) {
        const lang = detectLanguage(text);
        if (lang.en + lang.ru + lang.other === 0) continue;
        totalEn += lang.en;
        totalRu += lang.ru;
        totalOther += lang.other;
        sampledMessages++;
      }
    }

    const total = totalEn + totalRu + totalOther;
    const result: LanguageStats = {
      englishPercent: total > 0 ? Math.round((totalEn / total) * 100) : 0,
      russianPercent: total > 0 ? Math.round((totalRu / total) * 100) : 0,
      otherPercent: total > 0 ? Math.round((totalOther / total) * 100) : 0,
      sampledMessages,
      dominantLanguage: totalRu > totalEn ? 'ru' : totalEn > totalRu * 2 ? 'en' : 'mixed',
    };

    this.cache.set(apiKeyName, { data: result, expiry: Date.now() + 600_000 });
    return result;
  }
}
