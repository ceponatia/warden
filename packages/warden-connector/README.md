# @aspect/warden-connector

Thin middleware wrapper that tracks API route hits for Warden runtime collection.

## Usage

```ts
import { withTracking } from "@aspect/warden-connector";

export const GET = withTracking(async (request: Request) => {
  return new Response(JSON.stringify({ ok: true }));
});
```

By default, events are appended to `.warden/runtime/api-hits.jsonl`.

## Options

- `outputPath`: override JSONL output path
- `routeResolver`: override route derivation from request
