# ai-sdk-provider-readaloud

[ReadAloud](https://readaloudai.org) text-to-speech provider for the [Vercel AI SDK](https://ai-sdk.dev). Use ReadAloud
with `generateSpeech()` from the `ai` package.

- Implements the AI SDK `SpeechModelV4` interface (AI SDK 7).
- One runtime dependency: `@ai-sdk/provider`. ESM only, TypeScript types included.
- Returns audio bytes with the right media type, warnings for unsupported options, and request/response metadata.

> Status: **0.1.0, not yet published to npm.** Until it is, clone and build:
> `git clone https://github.com/tsushanth/ai-sdk-provider-readaloud && cd ai-sdk-provider-readaloud && npm ci && npm run build`,
> then depend on the folder (`npm install /path/to/ai-sdk-provider-readaloud`).

## Install

```bash
npm install ai-sdk-provider-readaloud ai
```

Set your API key (get one at [readaloudai.org](https://readaloudai.org)):

```bash
export READALOUD_API_KEY=your_key_here
```

## Usage

```ts
import { writeFile } from 'node:fs/promises';
import { generateSpeech } from 'ai';
import { readaloud } from 'ai-sdk-provider-readaloud';

const { audio, warnings } = await generateSpeech({
  model: readaloud.speech(),
  text: 'Hello from ReadAloud.',
  voice: 'piper-default',
  outputFormat: 'mp3',   // mp3 | opus | wav | pcm
  speed: 1.0,            // 0.25 - 4
});

await writeFile('speech.mp3', audio.uint8Array);
console.log(audio.mediaType); // "audio/mpeg"
```

A runnable version is in [`examples/generate-speech.ts`](examples/generate-speech.ts).

### Custom provider instance

```ts
import { createReadAloud } from 'ai-sdk-provider-readaloud';

const readaloud = createReadAloud({
  apiKey: process.env.READALOUD_API_KEY, // default: READALOUD_API_KEY env var
  baseURL: 'https://api.readaloudai.org', // default
  headers: { 'x-my-header': 'value' },
  fetch: customFetch,                     // optional
});
```

| Setting   | Default                         | Notes                                                              |
| --------- | ------------------------------- | ------------------------------------------------------------------ |
| `apiKey`  | `process.env.READALOUD_API_KEY` | Sent as `Authorization: Bearer ...`. Read when a request is made.   |
| `baseURL` | `https://api.readaloudai.org`   | A trailing `/` or `/v1` is accepted.                               |
| `headers` | none                            | Added to every request.                                            |
| `fetch`   | global `fetch`                  | For proxies, instrumentation, tests.                               |

`readaloud.speech(modelId)` and `readaloud.speechModel(modelId)` are equivalent, and so is calling `readaloud(modelId)`.
The model id does not select a voice (use the `voice` option), so `'default'` is fine; the id is still forwarded.

## Options

| `generateSpeech` option | Behaviour                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `text`                  | Required, up to 5000 characters (longer input is rejected by the API with a 400).                  |
| `voice`                 | `piper-default` (default). OpenAI stock voice names such as `alloy` are accepted and map to the same default voice. |
| `outputFormat`          | `mp3` (default), `opus` (Ogg), `wav`, `pcm` (24 kHz, 16-bit mono). Anything else (for example `aac`, `flac`) produces a warning and falls back to `mp3`. |
| `speed`                 | 0.25 to 4. Values outside the range are clamped, with a warning.                                   |
| `instructions`          | Not supported. Ignored with a warning.                                                            |
| `language`              | Not supported (the voice decides the language). Ignored with a warning.                            |
| `abortSignal`           | Passed to `fetch`; aborting rejects with an `AbortError`.                                          |
| `headers`               | Per-call headers, merged over the provider headers.                                               |

Result extras: `providerMetadata.readaloud` contains `characterCount`, `sampleRate` and `audioFormat` as reported by the
API (fields are omitted if the server does not send them). `responses[0].headers` has the raw response headers.

## Error handling

Non-2xx responses throw the AI SDK's `APICallError` with the message from ReadAloud's OpenAI-shaped error body
(`{"error":{"message","type","param","code"}}`), plus `statusCode`, `responseHeaders`, `responseBody` and the parsed
body in `data`.

```ts
import { APICallError } from '@ai-sdk/provider';

try {
  await generateSpeech({ model: readaloud.speech(), text: 'Hi' });
} catch (error) {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401) console.error('Check READALOUD_API_KEY');
    if (error.statusCode === 402) console.error('Free tier exhausted');
    console.error(error.message, error.isRetryable);
  }
}
```

`isRetryable` is `true` for 408, 409, 429 and 5xx (and for network failures), so `generateSpeech`'s built-in
`maxRetries` retries those automatically (for example when the service is at capacity). 400, 401, 402 and 404 are not
retried. A missing API key throws `LoadAPIKeyError` when a request is made, not when the provider is created.

## Compatibility

| Package               | Tested version |
| --------------------- | -------------- |
| `ai`                  | 7.0.137        |
| `@ai-sdk/provider`    | 4.0.26         |
| Node.js               | 22, 24         |

This package targets the AI SDK 7 provider specification (`specificationVersion: 'v4'`). On AI SDK 6
(`SpeechModelV3`), ReadAloud's OpenAI-compatible endpoint works through `@ai-sdk/openai`:
`createOpenAI({ baseURL: 'https://api.readaloudai.org/v1', apiKey }).speech('tts-1')` with
`experimental_generateSpeech` (checked against `ai@6.0.303` and `@ai-sdk/openai@3.0.125`).

## Development

```bash
npm ci
npm run typecheck && npm run build && npm test     # unit tests, mocked fetch
READALOUD_API_KEY=... npm run test:live            # live tests against the real API (skipped without a key)
READALOUD_API_KEY=... npm run example              # writes speech.mp3
```

## Maintainer

Written and maintained by the author of ReadAloud, Sushanth Tiruvaipati ([@tsushanth](https://github.com/tsushanth)).
Issues and pull requests are welcome.

## License

MIT, see [LICENSE](LICENSE).
