import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ToolStats {
  totalToolCalls: number;
  uniqueTools: number;
  toolNames: string[];
  sampledRequests: number;
}

export interface ArtifactStats {
  estimatedArtifacts: number;
  codeBlocks: number;
  fileWrites: number;
  sampledRequests: number;
}

export class ToolAnalyzer {
  private logsPath: string;
  private cache = new Map<string, { data: ToolStats; expiry: number }>();
  private artifactCache = new Map<string, { data: ArtifactStats; expiry: number }>();

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

  async getUserArtifactStats(apiKeyName: string, sampleSize = 100): Promise<ArtifactStats> {
    const cached = this.artifactCache.get(apiKeyName);
    if (cached && cached.expiry > Date.now()) return cached.data;

    let codeBlocks = 0;
    let fileWrites = 0;
    let sampledRequests = 0;

    const WRITE_TOOL_PATTERN = /write|create|edit/i;

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

            // Count code blocks in assistant response text
            const responseBody = content.responseBody as Record<string, unknown> | undefined;
            const choices = responseBody?.choices;
            const output = responseBody?.output;

            // Anthropic format: content array with text blocks
            if (Array.isArray(output)) {
              for (const item of output as Record<string, unknown>[]) {
                if (item.type === 'text' && typeof item.text === 'string') {
                  const matches = (item.text as string).match(/```/g);
                  if (matches) codeBlocks += Math.floor(matches.length / 2);
                }
              }
            }

            // OpenAI format: choices[].message.content
            if (Array.isArray(choices)) {
              for (const choice of choices as Record<string, unknown>[]) {
                const msg = choice.message as Record<string, unknown> | undefined;
                const text = msg?.content;
                if (typeof text === 'string') {
                  const matches = text.match(/```/g);
                  if (matches) codeBlocks += Math.floor(matches.length / 2);
                }
              }
            }

            // Count file-write tool calls in request messages
            const messages: unknown[] = content.requestBody?.messages ?? [];
            for (const msg of messages) {
              const m = msg as Record<string, unknown>;

              // Anthropic format: content blocks with type "tool_use"
              if (Array.isArray(m.content)) {
                for (const block of m.content as Record<string, unknown>[]) {
                  if (block.type === 'tool_use' && typeof block.name === 'string') {
                    if (WRITE_TOOL_PATTERN.test(block.name)) fileWrites++;
                  }
                }
              }

              // OpenAI format: assistant message with tool_calls array
              if (Array.isArray(m.tool_calls)) {
                for (const tc of m.tool_calls as Record<string, unknown>[]) {
                  const fn = tc.function as Record<string, unknown> | undefined;
                  if (typeof fn?.name === 'string' && WRITE_TOOL_PATTERN.test(fn.name)) {
                    fileWrites++;
                  }
                }
              }
            }

            // Check response output for tool calls
            if (Array.isArray(output)) {
              for (const item of output as Record<string, unknown>[]) {
                if ((item.type === 'function_call' || item.type === 'tool_use') && typeof item.name === 'string') {
                  if (WRITE_TOOL_PATTERN.test(item.name)) fileWrites++;
                }
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

    const result: ArtifactStats = {
      estimatedArtifacts: codeBlocks + fileWrites,
      codeBlocks,
      fileWrites,
      sampledRequests,
    };

    this.artifactCache.set(apiKeyName, { data: result, expiry: Date.now() + 300_000 });
    return result;
  }
}
