import type { Database } from 'bun:sqlite';
import { ArtifactReader, collectAssistantTexts, collectToolNames } from './artifact-reader.ts';

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
  private artifactReader: ArtifactReader;
  private cache = new Map<string, { data: ToolStats; expiry: number }>();
  private artifactCache = new Map<string, { data: ArtifactStats; expiry: number }>();

  constructor(db: Database, logsPath?: string) {
    this.artifactReader = new ArtifactReader(db, logsPath);
  }

  async getUserToolStats(apiKeyName: string, sampleSize = 100): Promise<ToolStats> {
    const cached = this.cache.get(apiKeyName);
    if (cached && cached.expiry > Date.now()) return cached.data;

    let totalToolCalls = 0;
    const toolNamesSet = new Set<string>();
    let sampledRequests = 0;

    const records = await this.artifactReader.getUserArtifacts(apiKeyName, sampleSize);
    for (const record of records) {
      sampledRequests++;
      const names = collectToolNames(record.payload);
      totalToolCalls += names.length;
      for (const name of names) toolNamesSet.add(name);
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

    const records = await this.artifactReader.getUserArtifacts(apiKeyName, sampleSize);
    for (const record of records) {
      sampledRequests++;
      for (const text of collectAssistantTexts(record.payload)) {
        const matches = text.match(/```/g);
        if (matches) codeBlocks += Math.floor(matches.length / 2);
      }
      for (const toolName of collectToolNames(record.payload)) {
        if (WRITE_TOOL_PATTERN.test(toolName)) fileWrites++;
      }
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
