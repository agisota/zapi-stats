import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

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
  private logsPath: string;
  private cache = new Map<string, { data: LanguageStats; expiry: number }>();

  constructor(logsPath: string) {
    this.logsPath = logsPath;
  }

  async getUserLanguageStats(apiKeyName: string, sampleSize = 50): Promise<LanguageStats> {
    const cached = this.cache.get(apiKeyName);
    if (cached && cached.expiry > Date.now()) return cached.data;

    let totalEn = 0;
    let totalRu = 0;
    let totalOther = 0;
    let sampledMessages = 0;
    let sampledRequests = 0;

    outer:
    try {
      const dates = await readdir(this.logsPath);
      const sortedDates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

      for (const date of sortedDates) {
        const dayPath = join(this.logsPath, date);
        let files: string[];
        try {
          files = await readdir(dayPath);
        } catch {
          continue;
        }
        const sorted = files.filter(f => f.endsWith('.json')).sort().reverse();

        for (const file of sorted) {
          if (sampledRequests >= sampleSize) break outer;

          try {
            const content = await Bun.file(join(dayPath, file)).json();
            if (content.apiKeyName !== apiKeyName) continue;

            sampledRequests++;
            const messages: Array<{ role: string; content: unknown }> = content.requestBody?.messages ?? [];

            for (const msg of messages) {
              if (msg.role !== 'user') continue;

              const text = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                  ? (msg.content as Array<{ type: string; text?: string }>)
                      .filter(b => b.type === 'text')
                      .map(b => b.text ?? '')
                      .join(' ')
                  : '';

              if (text.length < 10) continue;

              const lang = detectLanguage(text);
              totalEn += lang.en;
              totalRu += lang.ru;
              totalOther += lang.other;
              sampledMessages++;
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // logsPath not available — return zero stats
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
