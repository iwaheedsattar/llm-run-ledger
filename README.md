# llm-run-ledger

`llm-run-ledger` is a small CLI for turning JSONL LLM request logs into token, cost, latency, and budget summaries. It is built for local logs from scripts, CLIs, workers, batch jobs, and eval runs where a spreadsheet is too manual but a billing dashboard is too far away.

## What it reads

Each line should be a JSON object. Field names are intentionally flexible:

```jsonl
{"created_at":"2026-05-16T09:10:00Z","model":"gpt-4.1-mini","input_tokens":1200,"output_tokens":180,"duration_ms":840,"status":"ok"}
{"created_at":"2026-05-16T10:05:42Z","model":"claude-3-5-haiku","prompt_tokens":900,"completion_tokens":210,"latency_ms":760,"ok":true}
{"created_at":"2026-05-16T10:08:19Z","model":"local/llama3.1","total_tokens":1600,"duration_ms":2100}
```

Supported aliases include `input_tokens`, `prompt_tokens`, `output_tokens`, `completion_tokens`, `total_tokens`, `duration_ms`, `latency_ms`, `cost_usd`, `created_at`, `timestamp`, `status`, and `ok`.

## Installation

```bash
npm install -g llm-run-ledger
```

For local development:

```bash
git clone https://github.com/iwaheedsattar/llm-run-ledger.git
cd llm-run-ledger
npm test
```

## Usage

Summarize one or more JSONL files by model:

```bash
llm-run-ledger usage.jsonl
```

Group by day:

```bash
llm-run-ledger usage.jsonl --group-by day
```

Read from stdin and fail when spend exceeds a budget:

```bash
cat usage.jsonl | llm-run-ledger --budget 2.50
```

Emit JSON for CI or dashboards:

```bash
llm-run-ledger usage.jsonl --format json
```

Example table:

```text
group             req  fail  input  output  total  cost     avg latency
gpt-4.1-mini      2    0     3600   700     4300   $0.0026  1080ms
claude-3-5-haiku  1    0     900    210     1110   $0.0016  760ms
local/llama3.1    1    0     0      0       1600   $0.0000  2100ms
total             4    0     4500   910     7010   $0.0042  -
```

## Pricing

The CLI includes a small default price table for common hosted models. Prices are expressed as USD per million tokens:

```json
{
  "my-model": { "input": 0.25, "output": 1.00 }
}
```

Merge a custom table:

```bash
llm-run-ledger usage.jsonl --prices prices.json
```

If a model is unknown and no explicit `cost_usd` is present, the cost is reported as zero while token counts are still summarized.

## Exit codes

`0` means the report completed successfully.

`1` means the CLI arguments or input files could not be processed.

`2` means the report completed but `--budget` was exceeded.

## Development

```bash
npm run build
npm test
npm run smoke
```

The project has no runtime dependencies and uses Node's built-in test runner.

## Contributing

Issues and pull requests are welcome. Please include a small JSONL fixture or test case when changing parsing behavior.
