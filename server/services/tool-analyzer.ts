import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ToolStats {
  totalToolCalls: number;
  uniqueTools: number;
  toolNames: string[];
  sampledRequests: number;
}

export class ToolAnalyzer {
  private logsPath: string;
  private cache = new Map<string, { data: ToolStats; expiry: number }>();

  constructor(logsPath: string) {
    this.logsPath = logsPath;
  }

  async getUserToolStats(apiKeyName: string, sampleSize = 100): Promise<ToolStats> {
    const cached = this.cache.get(apiKeyName);
    if (cached && cached.expiry > Date.now()) return cached.data;

    let totalToolCalls = 0;
    const toolNamesSet = new Set<string>();
    let sampledRequests = 0;

    try {
      const entries = await readdir(this.logsPath);
      const sortedDates = entries
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
        .reverse();

      outer:
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
            const messages: unknown[] = content.requestBody?.messages ?? [];

            for (const msg of messages) {
              const m = msg as Record<string, unknown>;

              // Anthropic format: content blocks with type "tool_use"
              if (Array.isArray(m.content)) {
                for (const block of m.content as Record<string, unknown>[]) {
                  if (block.type === 'tool_use') {
                    totalToolCalls++;
                    if (typeof block.name === 'string') toolNamesSet.add(block.name);
                  }
                }
              }

              // OpenAI format: role "tool" message
              if (m.role === 'tool') totalToolCalls++;

              // OpenAI format: assistant message with tool_calls array
              if (Array.isArray(m.tool_calls)) {
                totalToolCalls += m.tool_calls.length;
                for (const tc of m.tool_calls as Record<string, unknown>[]) {
                  const fn = tc.function as Record<string, unknown> | undefined;
                  if (typeof fn?.name === 'string') toolNamesSet.add(fn.name);
                }
              }
            }

            // Check response output for tool calls
            const output: unknown[] = content.responseBody?.output ?? content.responseBody?.choices ?? [];
            for (const item of Array.isArray(output) ? output : []) {
              const it = item as Record<string, unknown>;
              if (it.type === 'function_call' || it.type === 'tool_use') {
                totalToolCalls++;
                if (typeof it.name === 'string') toolNamesSet.add(it.name);
              }
              const msgTc = (it.message as Record<string, unknown> | undefined)?.tool_calls;
              if (Array.isArray(msgTc)) {
                totalToolCalls += msgTc.length;
              }
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // logs path not available
    }

    const result: ToolStats = {
      totalToolCalls,
      uniqueTools: toolNamesSet.size,
      toolNames: [...toolNamesSet].slice(0, 20),
      sampledRequests,
    };

    this.cache.set(apiKeyName, { data: result, expiry: Date.now() + 300_000 });
    return result;
  }
}
