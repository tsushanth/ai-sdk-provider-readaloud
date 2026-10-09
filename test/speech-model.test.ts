import { APICallError, LoadAPIKeyError, NoSuchModelError } from '@ai-sdk/provider';
import { generateSpeech } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadAloud, readaloud } from '../src/index.js';
import { VERSION } from '../src/version.js';
import pkg from '../package.json' with { type: 'json' };

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

type Call = { url: string; init: RequestInit };

function mockFetch(
  respond: (call: Call) => Response | Promise<Response> = () =>
    new Response(AUDIO, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'x-character-count': '5',
        'x-sample-rate': '24000',
        'x-audio-format': 'mp3_24000_128',
      },
    }),
) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

const body = (c: Call) => JSON.parse(c.init.body as string);
const hdr = (c: Call, name: string) =>
  Object.entries(c.init.headers as Record<string, string>).find(
    ([k]) => k.toLowerCase() === name,
  )?.[1];

describe('request shape', () => {
  it('posts OpenAI-shaped JSON to /v1/audio/speech with bearer auth', async () => {
    const { fn, calls } = mockFetch();
    const model = createReadAloud({ apiKey: 'k1', fetch: fn }).speech('default');
    await model.doGenerate({
      text: 'Hello',
      voice: 'af_heart',
      outputFormat: 'wav',
      speed: 1.5,
    });
    expect(calls).toHaveLength(1);
    const [c] = calls as [Call];
    expect(c.url).toBe('https://api.readaloudai.org/v1/audio/speech');
    expect(c.init.method).toBe('POST');
    expect(hdr(c, 'authorization')).toBe('Bearer k1');
    expect(hdr(c, 'content-type')).toBe('application/json');
    expect(body(c)).toEqual({
      model: 'default',
      input: 'Hello',
      voice: 'af_heart',
      response_format: 'wav',
      speed: 1.5,
    });
  });

  it('defaults voice to "default", format to mp3, and omits speed', async () => {
    const { fn, calls } = mockFetch();
    await createReadAloud({ apiKey: 'k', fetch: fn }).speech().doGenerate({ text: 'Hi' });
    expect(body(calls[0]!)).toEqual({
      model: 'default',
      input: 'Hi',
      voice: 'piper-default',
      response_format: 'mp3',
    });
  });

  it('honours baseURL (with /v1 or trailing slash), custom headers and per-call headers', async () => {
    const { fn, calls } = mockFetch();
    const model = createReadAloud({
      apiKey: 'k',
      baseURL: 'https://proxy.example.com/v1/',
      headers: { 'x-team': 'a' },
      fetch: fn,
    }).speech();
    await model.doGenerate({ text: 'Hi', headers: { 'x-call': 'b', 'X-Team': 'override' } });
    const [c] = calls as [Call];
    expect(c.url).toBe('https://proxy.example.com/v1/audio/speech');
    expect(hdr(c, 'x-call')).toBe('b');
    expect(hdr(c, 'x-team')).toBe('override');
  });

  it('appends its user agent to the one set by the AI SDK', async () => {
    const { fn, calls } = mockFetch();
    await createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi', headers: { 'user-agent': 'ai/7.0.0' } });
    expect(hdr(calls[0]!, 'user-agent')).toBe(`ai/7.0.0 ai-sdk-provider-readaloud/${VERSION}`);
  });

  it('forwards the model id as the model field', async () => {
    const { fn, calls } = mockFetch();
    await createReadAloud({ apiKey: 'k', fetch: fn }).speech('tts-1').doGenerate({ text: 'Hi' });
    expect(body(calls[0]!).model).toBe('tts-1');
  });
});

describe('api key', () => {
  const original = process.env.READALOUD_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.READALOUD_API_KEY;
    else process.env.READALOUD_API_KEY = original;
  });

  it('falls back to READALOUD_API_KEY', async () => {
    process.env.READALOUD_API_KEY = 'from-env';
    const { fn, calls } = mockFetch();
    await createReadAloud({ fetch: fn }).speech().doGenerate({ text: 'Hi' });
    expect(hdr(calls[0]!, 'authorization')).toBe('Bearer from-env');
  });

  it('explicit apiKey wins over the environment', async () => {
    process.env.READALOUD_API_KEY = 'from-env';
    const { fn, calls } = mockFetch();
    await createReadAloud({ apiKey: 'explicit', fetch: fn }).speech().doGenerate({ text: 'Hi' });
    expect(hdr(calls[0]!, 'authorization')).toBe('Bearer explicit');
  });

  it('throws LoadAPIKeyError at call time (not at creation) when missing', async () => {
    delete process.env.READALOUD_API_KEY;
    const { fn, calls } = mockFetch();
    const model = createReadAloud({ fetch: fn }).speech(); // must not throw
    await expect(model.doGenerate({ text: 'Hi' })).rejects.toSatisfy(LoadAPIKeyError.isInstance);
    expect(calls).toHaveLength(0);
  });
});

describe('result', () => {
  it('returns audio bytes, request/response metadata and provider metadata', async () => {
    const { fn } = mockFetch();
    const provider = createReadAloud({ apiKey: 'k', fetch: fn });
    const model = provider.speech('default');
    const result = await model.doGenerate({ text: 'Hello' });
    expect(result.audio).toEqual(AUDIO);
    expect(result.warnings).toEqual([]);
    expect(JSON.parse((result.request!.body as string))).toMatchObject({ input: 'Hello' });
    expect(result.response.modelId).toBe('default');
    expect(result.response.timestamp).toBeInstanceOf(Date);
    expect(result.response.headers?.['content-type']).toBe('audio/mpeg');
    expect(result.providerMetadata).toEqual({
      readaloud: { characterCount: 5, sampleRate: 24000, audioFormat: 'mp3_24000_128' },
    });
  });

  it('works end to end through generateSpeech() with the right mediaType', async () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    ]);
    const { fn } = mockFetch(
      () => new Response(wav, { headers: { 'content-type': 'audio/wav' } }),
    );
    const res = await generateSpeech({
      model: createReadAloud({ apiKey: 'k', fetch: fn }).speech(),
      text: 'Hello',
      outputFormat: 'wav',
    });
    expect(res.audio.mediaType).toBe('audio/wav');
    expect(res.audio.uint8Array).toEqual(wav);
    expect(res.warnings).toEqual([]);
  });

  it('falls back to the response content-type for pcm', async () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const { fn } = mockFetch(() => new Response(pcm, { headers: { 'content-type': 'audio/pcm' } }));
    const res = await generateSpeech({
      model: createReadAloud({ apiKey: 'k', fetch: fn }).speech(),
      text: 'Hello',
      outputFormat: 'pcm',
    });
    expect(res.audio.mediaType).toBe('audio/pcm');
  });

  it('omits provider metadata fields the server did not send', async () => {
    const { fn } = mockFetch(() => new Response(AUDIO));
    const r = await createReadAloud({ apiKey: 'k', fetch: fn }).speech().doGenerate({ text: 'x' });
    expect(r.providerMetadata).toEqual({ readaloud: {} });
  });
});

describe('warnings', () => {
  it('warns for instructions and language and still succeeds', async () => {
    const { fn, calls } = mockFetch();
    const r = await createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi', instructions: 'whisper', language: 'es' });
    expect(r.warnings.map(w => (w.type === 'unsupported' ? w.feature : w.type))).toEqual([
      'instructions',
      'language',
    ]);
    expect(body(calls[0]!)).not.toHaveProperty('instructions');
    expect(body(calls[0]!)).not.toHaveProperty('language');
  });

  it('warns and falls back to mp3 for unsupported formats (aac, flac)', async () => {
    for (const fmt of ['aac', 'flac', 'ulaw_8000']) {
      const { fn, calls } = mockFetch();
      const r = await createReadAloud({ apiKey: 'k', fetch: fn })
        .speech()
        .doGenerate({ text: 'Hi', outputFormat: fmt });
      expect(body(calls[0]!).response_format).toBe('mp3');
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatchObject({ type: 'unsupported', feature: 'outputFormat' });
    }
  });

  it('accepts format names case-insensitively without a warning', async () => {
    const { fn, calls } = mockFetch();
    const r = await createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi', outputFormat: 'OPUS' });
    expect(body(calls[0]!).response_format).toBe('opus');
    expect(r.warnings).toEqual([]);
  });

  it('clamps out-of-range speed with a warning, and keeps boundary values silently', async () => {
    const model = (fn: typeof fetch) => createReadAloud({ apiKey: 'k', fetch: fn }).speech();
    const hi = mockFetch();
    const rHi = await model(hi.fn).doGenerate({ text: 'Hi', speed: 10 });
    expect(body(hi.calls[0]!).speed).toBe(4);
    expect(rHi.warnings[0]).toMatchObject({ feature: 'speed' });
    const lo = mockFetch();
    await model(lo.fn).doGenerate({ text: 'Hi', speed: 0.1 });
    expect(body(lo.calls[0]!).speed).toBe(0.25);
    const ok = mockFetch();
    const rOk = await model(ok.fn).doGenerate({ text: 'Hi', speed: 0.25 });
    expect(rOk.warnings).toEqual([]);
  });
});

describe('error mapping', () => {
  const errorResponse = (status: number, message: string, code: string, extra: HeadersInit = {}) =>
    new Response(
      JSON.stringify({ error: { message, type: 'invalid_request_error', param: null, code } }),
      { status, headers: { 'content-type': 'application/json', ...extra } },
    );

  async function failWith(res: Response) {
    const { fn } = mockFetch(() => res);
    const err = await createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi' })
      .then(
        () => undefined,
        e => e,
      );
    expect(APICallError.isInstance(err)).toBe(true);
    return err as APICallError;
  }

  it('maps 401 to a non-retryable APICallError carrying the server message', async () => {
    const e = await failWith(errorResponse(401, 'Invalid API key', 'invalid_api_key'));
    expect(e.statusCode).toBe(401);
    expect(e.message).toBe('Invalid API key');
    expect(e.isRetryable).toBe(false);
    expect(e.url).toBe('https://api.readaloudai.org/v1/audio/speech');
    expect(e.data).toMatchObject({ error: { code: 'invalid_api_key' } });
    expect(e.responseBody).toContain('invalid_api_key');
    expect(e.responseHeaders?.['content-type']).toBe('application/json');
  });

  it('maps 402 (free tier exhausted) to a non-retryable error', async () => {
    const e = await failWith(errorResponse(402, 'Free tier exhausted', 'payment_required'));
    expect(e.statusCode).toBe(402);
    expect(e.isRetryable).toBe(false);
  });

  it('maps 400 to a non-retryable error', async () => {
    const e = await failWith(errorResponse(400, 'input too long', 'invalid_value'));
    expect(e.isRetryable).toBe(false);
  });

  it.each([429, 500, 502, 503, 504, 408])('treats %i as retryable', async status => {
    const e = await failWith(errorResponse(status, 'busy', 'at_capacity'));
    expect(e.isRetryable).toBe(true);
  });

  it('handles non-JSON error bodies', async () => {
    const e = await failWith(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(e.statusCode).toBe(502);
    expect(e.responseBody).toContain('bad gateway');
    expect(e.isRetryable).toBe(true);
    expect(e.data).toBeUndefined();
  });

  it('wraps network failures as retryable APICallError with the cause', async () => {
    const cause = new TypeError('fetch failed');
    const fn = (async () => {
      throw cause;
    }) as typeof fetch;
    const err = await createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi' })
      .catch(e => e);
    expect(APICallError.isInstance(err)).toBe(true);
    expect(err.isRetryable).toBe(true);
    expect(err.cause).toBe(cause);
  });

  it('surfaces the error through generateSpeech() (401 is not retried)', async () => {
    const { fn, calls } = mockFetch(() => errorResponse(401, 'Invalid API key', 'invalid_api_key'));
    await expect(
      generateSpeech({ model: createReadAloud({ apiKey: 'k', fetch: fn }).speech(), text: 'Hi' }),
    ).rejects.toSatisfy(APICallError.isInstance);
    expect(calls).toHaveLength(1);
  });

  it('retries 503 via generateSpeech() and then succeeds', async () => {
    let n = 0;
    const { fn, calls } = mockFetch(() =>
      ++n === 1
        ? errorResponse(503, 'at capacity', 'at_capacity')
        : new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }),
    );
    const res = await generateSpeech({
      model: createReadAloud({ apiKey: 'k', fetch: fn }).speech(),
      text: 'Hi',
      maxRetries: 2,
    });
    expect(calls).toHaveLength(2);
    expect(res.audio.mediaType).toBe('audio/mpeg');
  });
});

describe('abort signal', () => {
  it('passes the abort signal to fetch', async () => {
    const { fn, calls } = mockFetch();
    const ctrl = new AbortController();
    await createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi', abortSignal: ctrl.signal });
    expect(calls[0]!.init.signal).toBe(ctrl.signal);
  });

  it('rejects with an AbortError (not APICallError) when aborted mid-request', async () => {
    const fn = ((_u: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as typeof fetch;
    const ctrl = new AbortController();
    const p = createReadAloud({ apiKey: 'k', fetch: fn })
      .speech()
      .doGenerate({ text: 'Hi', abortSignal: ctrl.signal });
    ctrl.abort();
    const err = await p.catch(e => e);
    expect(err.name).toBe('AbortError');
    expect(APICallError.isInstance(err)).toBe(false);
  });

  it('works with a real already-aborted signal through generateSpeech()', async () => {
    const { fn } = mockFetch();
    const ctrl = new AbortController();
    ctrl.abort();
    const honouring = ((u: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return fn(u, init);
    }) as typeof fetch;
    await expect(
      generateSpeech({
        model: createReadAloud({ apiKey: 'k', fetch: honouring }).speech(),
        text: 'Hi',
        abortSignal: ctrl.signal,
      }),
    ).rejects.toThrow();
  });
});

describe('provider surface', () => {
  it('exposes speech, speechModel and the callable form with v4 spec version', () => {
    const p = createReadAloud({ apiKey: 'k' });
    expect(p.specificationVersion).toBe('v4');
    for (const m of [p.speech('x'), p.speechModel('x'), p('x')]) {
      expect(m.specificationVersion).toBe('v4');
      expect(m.provider).toBe('readaloud.speech');
      expect(m.modelId).toBe('x');
    }
    expect(readaloud.speech().modelId).toBe('default');
  });

  it('throws NoSuchModelError for non-speech model types', () => {
    const p = createReadAloud({ apiKey: 'k' });
    expect(() => p.languageModel('x')).toThrow(NoSuchModelError);
    expect(() => p.embeddingModel('x')).toThrow(NoSuchModelError);
    expect(() => p.imageModel('x')).toThrow(NoSuchModelError);
  });

  it('keeps VERSION in sync with package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('has no runtime dependency besides @ai-sdk/provider', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['@ai-sdk/provider']);
  });
});

beforeEach(() => vi.restoreAllMocks());
