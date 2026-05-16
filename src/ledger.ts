import { readFileSync } from "node:fs";

export type UsageRecord = {
  source: string;
  line: number;
  createdAt?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs?: number;
  ok: boolean;
  costUsd: number;
};

export type PriceTable = Record<string, { input: number; output: number }>;

export type GroupBy = "model" | "day" | "none";

export type LedgerSummary = {
  rows: SummaryRow[];
  totals: SummaryRow;
  warnings: string[];
  skipped: number;
};

export type SummaryRow = {
  key: string;
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs?: number;
};

export const defaultPrices: PriceTable = {
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 }
};

type RawRecord = Record<string, unknown>;

export function loadPriceTable(path?: string): PriceTable {
  if (!path) return defaultPrices;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as PriceTable;
  return { ...defaultPrices, ...parsed };
}

export function parseJsonl(input: string, source = "stdin", prices: PriceTable = defaultPrices): { records: UsageRecord[]; skipped: number; warnings: string[] } {
  const records: UsageRecord[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    let raw: RawRecord;
    try {
      raw = JSON.parse(line) as RawRecord;
    } catch {
      skipped += 1;
      warnings.push(`${source}:${index + 1} is not valid JSON`);
      return;
    }

    const record = normalizeRecord(raw, source, index + 1, prices);
    if (!record) {
      skipped += 1;
      warnings.push(`${source}:${index + 1} is missing model or token counts`);
      return;
    }
    records.push(record);
  });

  return { records, skipped, warnings };
}

export function summarize(records: UsageRecord[], groupBy: GroupBy = "model", budgetUsd?: number): LedgerSummary {
  const groups = new Map<string, { row: SummaryRow; latencies: number[] }>();

  for (const record of records) {
    const key = groupKey(record, groupBy);
    const entry = groups.get(key) ?? {
      row: emptyRow(key),
      latencies: []
    };

    entry.row.requests += 1;
    entry.row.failures += record.ok ? 0 : 1;
    entry.row.inputTokens += record.inputTokens;
    entry.row.outputTokens += record.outputTokens;
    entry.row.totalTokens += record.totalTokens;
    entry.row.costUsd += record.costUsd;
    if (typeof record.durationMs === "number") entry.latencies.push(record.durationMs);
    groups.set(key, entry);
  }

  const rows = [...groups.values()].map(({ row, latencies }) => ({
    ...row,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : undefined
  }));
  rows.sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));

  const totals = rows.reduce((acc, row) => {
    acc.requests += row.requests;
    acc.failures += row.failures;
    acc.inputTokens += row.inputTokens;
    acc.outputTokens += row.outputTokens;
    acc.totalTokens += row.totalTokens;
    acc.costUsd += row.costUsd;
    return acc;
  }, emptyRow("total"));

  const warnings: string[] = [];
  if (typeof budgetUsd === "number" && totals.costUsd > budgetUsd) {
    warnings.push(`budget exceeded: $${formatMoney(totals.costUsd)} > $${formatMoney(budgetUsd)}`);
  }

  return { rows, totals, warnings, skipped: 0 };
}

export function formatTable(summary: LedgerSummary): string {
  const rows = [...summary.rows, summary.totals].map((row) => [
    row.key,
    String(row.requests),
    String(row.failures),
    String(row.inputTokens),
    String(row.outputTokens),
    String(row.totalTokens),
    `$${formatMoney(row.costUsd)}`,
    row.avgLatencyMs ? `${row.avgLatencyMs}ms` : "-"
  ]);

  return renderRows([
    ["group", "req", "fail", "input", "output", "total", "cost", "avg latency"],
    ...rows
  ]);
}

export function formatMoney(value: number): string {
  return value.toFixed(value >= 1 ? 2 : 4);
}

function normalizeRecord(raw: RawRecord, source: string, line: number, prices: PriceTable): UsageRecord | undefined {
  const model = stringValue(raw.model) ?? stringValue(raw.model_name);
  const inputTokens = numberValue(raw.input_tokens) ?? numberValue(raw.prompt_tokens) ?? numberValue(raw.promptTokens) ?? 0;
  const outputTokens = numberValue(raw.output_tokens) ?? numberValue(raw.completion_tokens) ?? numberValue(raw.completionTokens) ?? 0;
  const totalTokens = numberValue(raw.total_tokens) ?? numberValue(raw.totalTokens) ?? inputTokens + outputTokens;

  if (!model || totalTokens <= 0) return undefined;

  const knownPrice = prices[model];
  const explicitCost = numberValue(raw.cost_usd) ?? numberValue(raw.costUsd);
  const costUsd = explicitCost ?? estimateCost(inputTokens, outputTokens, totalTokens, knownPrice);

  return {
    source,
    line,
    createdAt: stringValue(raw.created_at) ?? stringValue(raw.timestamp) ?? stringValue(raw.time),
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs: numberValue(raw.duration_ms) ?? numberValue(raw.latency_ms) ?? numberValue(raw.elapsed_ms),
    ok: okValue(raw),
    costUsd
  };
}

function estimateCost(inputTokens: number, outputTokens: number, totalTokens: number, price?: { input: number; output: number }): number {
  if (!price) return 0;
  const blendedInput = inputTokens || totalTokens;
  return (blendedInput / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

function groupKey(record: UsageRecord, groupBy: GroupBy): string {
  if (groupBy === "none") return "all";
  if (groupBy === "day") return record.createdAt?.slice(0, 10) || "unknown-day";
  return record.model;
}

function emptyRow(key: string): SummaryRow {
  return {
    key,
    requests: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0
  };
}

function renderRows(rows: string[][]): string {
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => row[index].length)));
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd()).join("\n");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function okValue(raw: RawRecord): boolean {
  if (typeof raw.ok === "boolean") return raw.ok;
  if (typeof raw.success === "boolean") return raw.success;
  const status = stringValue(raw.status)?.toLowerCase();
  if (!status) return true;
  return !["error", "failed", "fail", "timeout"].includes(status);
}
