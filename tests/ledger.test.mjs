import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonl, summarize, formatTable } from "../dist/ledger.js";

test("parses common token field names and estimates known model cost", () => {
  const input = [
    '{"created_at":"2026-05-16T10:00:00Z","model":"gpt-4.1-mini","input_tokens":1000000,"output_tokens":500000,"duration_ms":1000}',
    '{"created_at":"2026-05-16T11:00:00Z","model":"gpt-4.1-mini","prompt_tokens":1000,"completion_tokens":100,"status":"error"}'
  ].join("\n");

  const parsed = parseJsonl(input);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[1].ok, false);

  const summary = summarize(parsed.records, "model", 1);
  assert.equal(summary.rows[0].key, "gpt-4.1-mini");
  assert.equal(summary.rows[0].requests, 2);
  assert.equal(summary.rows[0].failures, 1);
  assert.equal(summary.rows[0].avgLatencyMs, 1000);
  assert.ok(summary.totals.costUsd > 1);
  assert.match(summary.warnings[0], /budget exceeded/);
});

test("groups records by day", () => {
  const parsed = parseJsonl([
    '{"created_at":"2026-05-16T10:00:00Z","model":"local/a","total_tokens":10}',
    '{"created_at":"2026-05-17T10:00:00Z","model":"local/a","total_tokens":20}'
  ].join("\n"));

  const summary = summarize(parsed.records, "day");
  assert.deepEqual(summary.rows.map((row) => row.key).sort(), ["2026-05-16", "2026-05-17"]);
});

test("reports invalid and incomplete jsonl lines", () => {
  const parsed = parseJsonl('{"model":"x"}\nnot-json\n{"model":"x","total_tokens":2}');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.warnings.length, 2);
});

test("renders table output with totals", () => {
  const parsed = parseJsonl('{"model":"local/a","total_tokens":2}');
  const table = formatTable(summarize(parsed.records));
  assert.match(table, /local\/a/);
  assert.match(table, /total/);
});
