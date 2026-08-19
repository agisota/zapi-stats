import { describe, expect, test } from 'bun:test';
import { createApp } from '../index.ts';
import { StatsService } from '../services/stats-service.ts';
import { createTestDb } from './fixtures/test-db.ts';
import type { Database } from 'bun:sqlite';

function addRecoveryEvents(db: Database): void {
  db.exec(`
    CREATE TABLE recovery_telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_lane TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      recorded_cost_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      extraction_basis TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE
    );
  `);
}

describe('observed activity', () => {
  test('returns zero telemetry when the recovery table is absent', () => {
    const db = createTestDb();
    const data = new StatsService(db).getObservedActivity();

    expect(data.api.requests).toBe(7);
    expect(data.telemetry.events).toBe(0);
    expect(data.observedEventsTotal).toBe(data.api.requests);
    expect(data.note).toContain('not equivalent');
  });

  test('aggregates telemetry by lane without changing API totals', () => {
    const db = createTestDb();
    addRecoveryEvents(db);
    db.query(`
      INSERT INTO recovery_telemetry_events
        (source_lane, source_event_id, observed_at, model, provider, input_tokens, output_tokens, total_tokens, recorded_cost_usd, status, extraction_basis, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'codex', 'c1', '2026-02-24T07:31:16.284Z', 'gpt-5.4', 'codex', 10, 20, 30, 0, 'observed', 'test', 'd-c1',
      'omp', 'o1', '2026-06-11T15:03:18.318Z', 'gpt-5.4', 'openai', 100, 40, 140, 1.5, 'observed', 'test', 'd-o1',
    );

    const data = new StatsService(db).getObservedActivity();

    expect(data.api.requests).toBe(7);
    expect(data.telemetry.events).toBe(2);
    expect(data.telemetry.totalTokens).toBe(170);
    expect(data.telemetry.recordedCost).toBe(1.5);
    expect(data.observedEventsTotal).toBe(9);
    expect(data.observedTokensTotal).toBe(data.api.tokensIn + data.api.tokensOut + 170);
    expect(data.telemetry.lanes.map(lane => lane.lane)).toEqual(['codex', 'omp']);
  });

  test('exposes the aggregate endpoint without raw telemetry rows', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const response = await app.request('http://localhost/api/stats/observed-activity');
    const body = await response.json() as { data: { observedEventsTotal: number; note: string; source_file?: string } };

    expect(response.status).toBe(200);
    expect(body.data.observedEventsTotal).toBe(7);
    expect(body.data.note).toContain('not equivalent');
    expect(body.data.source_file).toBeUndefined();
  });
});
