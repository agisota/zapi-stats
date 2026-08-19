import type { Database } from 'bun:sqlite';
import { join, resolve } from 'node:path';

export interface ArtifactLogRow {
  id: string;
  timestamp: string;
  apiKeyName: string;
  model: string | null;
  provider: string | null;
  requestSummary: string | null;
  artifactRelpath: string | null;
}

export interface ArtifactRecord {
  row: ArtifactLogRow;
  payload: Record<string, unknown>;
}

interface DbArtifactRow {
  id: string;
  timestamp: string;
  apiKeyName: string;
  model: string | null;
  provider: string | null;
  requestSummary: string | null;
  artifactRelpath: string | null;
}

export class ArtifactReader {
  private db: Database;
  private logsPath?: string;

  constructor(db: Database, logsPath?: string) {
    this.db = db;
    this.logsPath = logsPath;
  }

  async getUserArtifacts(apiKeyName: string, limit: number): Promise<ArtifactRecord[]> {
    if (!this.logsPath) return [];
    const rows = this.db.prepare(`
      SELECT
        id,
        timestamp,
        api_key_name as apiKeyName,
        model,
        provider,
        request_summary as requestSummary,
        artifact_relpath as artifactRelpath
      FROM call_logs
      WHERE api_key_name = ?
        AND artifact_relpath IS NOT NULL
        AND artifact_relpath != ''
        AND (has_request_body = 1 OR has_response_body = 1)
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(apiKeyName, Math.max(1, Math.min(limit * 4, 800))) as DbArtifactRow[];

    const records: ArtifactRecord[] = [];
    for (const row of rows) {
      if (records.length >= limit) break;
      const payload = await this.readArtifact(row.artifactRelpath);
      if (!payload) continue;
      records.push({
        row: {
          id: row.id,
          timestamp: row.timestamp,
          apiKeyName: row.apiKeyName,
          model: row.model,
          provider: row.provider,
          requestSummary: row.requestSummary,
          artifactRelpath: row.artifactRelpath,
        },
        payload,
      });
    }
    return records;
  }

  private async readArtifact(relpath: string | null): Promise<Record<string, unknown> | null> {
    if (!this.logsPath || !relpath) return null;
    const base = resolve(this.logsPath);
    const target = resolve(join(base, relpath));
    if (!target.startsWith(base)) return null;
    try {
      const parsed = await Bun.file(target).json();
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function collectPromptTexts(payload: Record<string, unknown>, fallback?: string | null): string[] {
  const requestBody = isRecord(payload.requestBody) ? payload.requestBody : {};
  const texts: string[] = [];

  collectFromMessages(requestBody.messages, texts);
  collectFromResponsesInput(requestBody.input, texts);
  collectTextBlocks(requestBody.prompt, texts);

  if (texts.length === 0 && fallback) texts.push(fallback);
  return texts.map(text => text.trim()).filter(text => text.length >= 10);
}

export function collectAssistantTexts(payload: Record<string, unknown>): string[] {
  const responseBody = isRecord(payload.responseBody) ? payload.responseBody : {};
  const texts: string[] = [];
  collectTextBlocks(responseBody.output, texts);
  collectTextBlocks(responseBody.choices, texts);
  collectTextBlocks(responseBody.content, texts);
  return texts.map(text => text.trim()).filter(text => text.length >= 10);
}

export function collectToolNames(payload: Record<string, unknown>): string[] {
  const names = new Set<string>();
  walk(payload.requestBody, value => {
    if (!isRecord(value)) return;
    if ((value.type === 'tool_use' || value.type === 'function_call') && typeof value.name === 'string') {
      names.add(value.name);
    }
    if (Array.isArray(value.tool_calls)) {
      for (const toolCall of value.tool_calls) {
        if (!isRecord(toolCall)) continue;
        const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
        const name = typeof fn?.name === 'string' ? fn.name : typeof toolCall.name === 'string' ? toolCall.name : null;
        if (name) names.add(name);
      }
    }
  });
  walk(payload.responseBody, value => {
    if (!isRecord(value)) return;
    if ((value.type === 'tool_use' || value.type === 'function_call') && typeof value.name === 'string') {
      names.add(value.name);
    }
    if (Array.isArray(value.tool_calls)) {
      for (const toolCall of value.tool_calls) {
        if (!isRecord(toolCall)) continue;
        const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
        const name = typeof fn?.name === 'string' ? fn.name : typeof toolCall.name === 'string' ? toolCall.name : null;
        if (name) names.add(name);
      }
    }
  });
  return [...names];
}

function collectFromMessages(value: unknown, out: string[]): void {
  if (!Array.isArray(value)) return;
  for (const message of value) {
    if (!isRecord(message)) continue;
    const role = typeof message.role === 'string' ? message.role : '';
    if (role && role !== 'user' && role !== 'developer' && role !== 'system') continue;
    collectTextBlocks(message.content, out);
  }
}

function collectFromResponsesInput(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const role = typeof item.role === 'string' ? item.role : '';
    if (role && role !== 'user' && role !== 'developer' && role !== 'system') continue;
    collectTextBlocks(item.content, out);
  }
}

function collectTextBlocks(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextBlocks(item, out);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.text === 'string') out.push(value.text);
  if (typeof value.content === 'string') out.push(value.content);
  if (isRecord(value.message)) collectTextBlocks(value.message.content, out);
  if (Array.isArray(value.content)) collectTextBlocks(value.content, out);
}

function walk(value: unknown, visit: (value: unknown) => void, depth = 0): void {
  if (depth > 12) return;
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const nested of Object.values(value)) walk(nested, visit, depth + 1);
}
