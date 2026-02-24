# V8 Coverage Dev Session

Use this workflow to generate runtime coverage data that `collect-runtime` can parse.

## 1) Set coverage output directory

```bash
export NODE_V8_COVERAGE="$PWD/.warden/runtime/v8-coverage"
mkdir -p "$NODE_V8_COVERAGE"
```

## 2) Start the target app in dev mode

Run your normal dev server command for the target repo.

## 3) Exercise routes manually or via scripts

Hit representative API routes and UI flows while the app is running.

## 4) Stop the app to flush coverage files

V8 writes JSON coverage artifacts when the process exits.

## 5) Run Warden collection

```bash
pnpm warden collect --repo <slug>
```

`collect-runtime` reads:

- `.warden/runtime/api-hits.jsonl` for route hit counts
- `.warden/runtime/v8-coverage/*.json` for script/function coverage summaries
