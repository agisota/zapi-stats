import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface LogEntry {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  status: number;
  duration: number;
  tokensIn: number;
  tokensOut: number;
  apiKeyName: string;
  sourceFormat: string;
  targetFormat: string;
  error: string | null;
}

export interface LogDetail extends LogEntry {
  requestBody: unknown;
  responseBody: unknown;
  method: string;
  path: string;
  account: string;
  connectionId: string;
  comboName: string | null;
  tokens: unknown;
}

export interface LogPage {
  logs: LogEntry[];
  nextCursor: string | null;
  total: number;
}

export class LogReader {
  private logsPath: string;

  constructor(logsPath: string) {
    this.logsPath = logsPath;
  }

  async getUserLogs(apiKeyName: string, options: {
    cursor?: string;
    limit?: number;
    date?: string;
    model?: string;
    provider?: string;
  } = {}): Promise<LogPage> {
    const limit = Math.min(options.limit ?? 50, 100);
    const dates = await this.getAvailableDates();

    // Filter to specific date or all dates (newest first)
    const targetDates = options.date
      ? dates.filter(d => d === options.date)
      : dates;

    const logs: LogEntry[] = [];
    let total = 0;
    let pastCursor = !options.cursor;
    let nextCursor: string | null = null;

    for (const date of targetDates) {
      if (logs.length >= limit) {
        nextCursor = logs[logs.length - 1]!.id;
        break;
      }

      const dayPath = join(this.logsPath, date);
      let files: string[];
      try {
        files = await readdir(dayPath);
      } catch {
        continue;
      }

      // Sort descending (newest first)
      files.sort().reverse();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await Bun.file(join(dayPath, file)).json();

          if (content.apiKeyName !== apiKeyName) continue;
          if (options.model && content.model !== options.model) continue;
          if (options.provider && content.provider !== options.provider) continue;

          total++;

          if (!pastCursor) {
            if (content.id === options.cursor) pastCursor = true;
            continue;
          }

          if (logs.length >= limit) {
            nextCursor = logs[logs.length - 1]!.id;
            break;
          }

          logs.push({
            id: content.id,
            timestamp: content.timestamp,
            model: content.model,
            provider: content.provider,
            status: content.status,
            duration: content.duration,
            tokensIn: content.tokensIn ?? 0,
            tokensOut: content.tokensOut ?? 0,
            apiKeyName: content.apiKeyName,
            sourceFormat: content.sourceFormat,
            targetFormat: content.targetFormat,
            error: content.error ?? null,
          });
        } catch {
          continue;
        }
      }
    }

    return { logs, nextCursor, total };
  }

  async getLogDetail(logId: string): Promise<LogDetail | null> {
    const dates = await this.getAvailableDates();

    for (const date of dates) {
      const dayPath = join(this.logsPath, date);
      let files: string[];
      try {
        files = await readdir(dayPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await Bun.file(join(dayPath, file)).json();
          if (content.id === logId) {
            return {
              id: content.id,
              timestamp: content.timestamp,
              model: content.model,
              provider: content.provider,
              status: content.status,
              duration: content.duration,
              tokensIn: content.tokensIn ?? 0,
              tokensOut: content.tokensOut ?? 0,
              apiKeyName: content.apiKeyName,
              sourceFormat: content.sourceFormat,
              targetFormat: content.targetFormat,
              error: content.error ?? null,
              requestBody: content.requestBody,
              responseBody: content.responseBody,
              method: content.method,
              path: content.path,
              account: content.account,
              connectionId: content.connectionId,
              comboName: content.comboName ?? null,
              tokens: content.tokens,
            };
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  async getAvailableDates(): Promise<string[]> {
    try {
      const entries = await readdir(this.logsPath);
      return entries
        .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
}
