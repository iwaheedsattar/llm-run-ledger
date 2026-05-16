#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { stdin } from "node:process";
import { formatTable, loadPriceTable, parseJsonl, summarize, type GroupBy } from "./ledger.js";

type Options = {
  files: string[];
  budget?: number;
  groupBy: GroupBy;
  format: "table" | "json";
  prices?: string;
  showHelp: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) {
    console.log(helpText());
    return;
  }

  const prices = loadPriceTable(options.prices);
  const chunks = options.files.length
    ? options.files.map((file) => ({ source: file, body: readFileSync(file, "utf8") }))
    : [{ source: "stdin", body: await readStdin() }];

  const warnings: string[] = [];
  const records = chunks.flatMap((chunk) => {
    const parsed = parseJsonl(chunk.body, chunk.source, prices);
    warnings.push(...parsed.warnings);
    return parsed.records;
  });

  const summary = summarize(records, options.groupBy, options.budget);
  summary.skipped = warnings.length;
  summary.warnings.push(...warnings);

  if (options.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatTable(summary));
    for (const warning of summary.warnings) {
      console.error(`warning: ${warning}`);
    }
  }

  const exceeded = summary.warnings.some((warning) => warning.startsWith("budget exceeded"));
  if (exceeded) process.exitCode = 2;
}

function parseArgs(args: string[]): Options {
  const options: Options = { files: [], groupBy: "model", format: "table", showHelp: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.showHelp = true;
    else if (arg === "--budget") options.budget = requiredNumber(args[++index], "--budget");
    else if (arg === "--group-by") options.groupBy = requiredGroup(args[++index]);
    else if (arg === "--format") options.format = requiredFormat(args[++index]);
    else if (arg === "--prices") options.prices = requiredValue(args[++index], "--prices");
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.files.push(arg);
  }

  return options;
}

function requiredValue(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function requiredNumber(value: string | undefined, option: string): number {
  const parsed = Number(requiredValue(value, option));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative number`);
  return parsed;
}

function requiredGroup(value: string | undefined): GroupBy {
  const group = requiredValue(value, "--group-by");
  if (group === "model" || group === "day" || group === "none") return group;
  throw new Error("--group-by must be model, day, or none");
}

function requiredFormat(value: string | undefined): "table" | "json" {
  const format = requiredValue(value, "--format");
  if (format === "table" || format === "json") return format;
  throw new Error("--format must be table or json");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      body += chunk;
    });
    stdin.on("end", () => resolve(body));
    stdin.on("error", reject);
  });
}

function helpText(): string {
  return `llm-run-ledger

Summarize JSONL LLM usage logs into spend, token, latency, and budget reports.

Usage:
  llm-run-ledger usage.jsonl [more.jsonl] [options]
  cat usage.jsonl | llm-run-ledger --group-by day

Options:
  --budget <usd>       Exit with code 2 when estimated spend exceeds this amount
  --group-by <mode>    model, day, or none (default: model)
  --format <format>    table or json (default: table)
  --prices <file>      Merge a JSON price table with built-in prices
  -h, --help           Show help
`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
