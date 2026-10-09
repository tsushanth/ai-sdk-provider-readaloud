import {
  APICallError,
  type JSONObject,
  type SharedV4Warning,
  type SpeechModelV4,
  type SpeechModelV4CallOptions,
  type SpeechModelV4Result,
} from '@ai-sdk/provider';
import { VERSION } from './version.js';

/** Audio formats supported by the ReadAloud `/v1/audio/speech` route. */
export type ReadAloudOutputFormat = 'mp3' | 'opus' | 'wav' | 'pcm';

const SUPPORTED_FORMATS: readonly string[] = ['mp3', 'opus', 'wav', 'pcm'];
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

/**
 * The OpenAI `model` field does not select a voice (use `voice`),
 * so any string is accepted. `'default'` is a sensible choice.
 */
export type ReadAloudSpeechModelId = 'default' | (string & {});

export type ReadAloudSpeechModelConfig = {
  provider: string;
  /** Base URL without a trailing slash, e.g. `https://api.readaloudai.org`. */
  baseURL: string;
  headers: () => Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Test hook. */
  currentDate?: () => Date;
};

function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function mergeHeaders(
  ...sources: Array<Record<string, string | undefined> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      // Case-insensitive de-duplication; later sources win.
      for (const existing of Object.keys(out)) {
        if (existing.toLowerCase() === lower) delete out[existing];
      }
      out[key] = value;
    }
  }
  return out;
}

function withUserAgent(headers: Record<string, string>): Record<string, string> {
  const suffix = `ai-sdk-provider-readaloud/${VERSION}`;
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'user-agent');
  if (key === undefined) return { ...headers, 'user-agent': suffix };
  return { ...headers, [key]: `${headers[key]} ${suffix}` };
}

async function parseErrorBody(
  text: string,
): Promise<{ message?: string; data?: unknown }> {
  if (!text) return {};
  try {
    const json = JSON.parse(text) as unknown;
    const err =
      json && typeof json === 'object'
        ? (json as { error?: unknown }).error
        : undefined;
    if (err && typeof err === 'object') {
      const message = (err as { message?: unknown }).message;
      return {
        message: typeof message === 'string' ? message : undefined,
        data: json,
      };
    }
    return { data: json };
  } catch {
    return {};
  }
}

export class ReadAloudSpeechModel implements SpeechModelV4 {
  readonly specificationVersion = 'v4' as const;

  constructor(
    readonly modelId: ReadAloudSpeechModelId,
    private readonly config: ReadAloudSpeechModelConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  private getArgs(options: SpeechModelV4CallOptions) {
    const warnings: SharedV4Warning[] = [];
    const { text, voice, outputFormat, instructions, speed, language } = options;

    let responseFormat: ReadAloudOutputFormat = 'mp3';
    if (outputFormat != null) {
      const normalized = outputFormat.trim().toLowerCase();
      if (SUPPORTED_FORMATS.includes(normalized)) {
        responseFormat = normalized as ReadAloudOutputFormat;
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'outputFormat',
          details: `Unsupported output format "${outputFormat}". Supported: ${SUPPORTED_FORMATS.join(', ')}. Using mp3 instead.`,
        });
      }
    }

    let effectiveSpeed = speed;
    if (speed != null && (speed < MIN_SPEED || speed > MAX_SPEED)) {
      effectiveSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
      warnings.push({
        type: 'unsupported',
        feature: 'speed',
        details: `Speed ${speed} is outside the supported range ${MIN_SPEED}-${MAX_SPEED}. Using ${effectiveSpeed} instead.`,
      });
    }

    if (instructions != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details: 'ReadAloud speech models do not support instructions. The parameter was ignored.',
      });
    }

    if (language != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'language',
        details: `ReadAloud selects the language from the voice. The language "${language}" was ignored.`,
      });
    }

    const body: Record<string, unknown> = {
      model: this.modelId,
      input: text,
      voice: voice ?? 'piper-default',
      response_format: responseFormat,
    };
    if (effectiveSpeed != null) body.speed = effectiveSpeed;

    return { body, warnings };
  }

  async doGenerate(options: SpeechModelV4CallOptions): Promise<SpeechModelV4Result> {
    const timestamp = (this.config.currentDate ?? (() => new Date()))();
    const { body, warnings } = this.getArgs(options);
    const url = `${this.config.baseURL}/v1/audio/speech`;
    const doFetch = this.config.fetch ?? globalThis.fetch;

    const headers = withUserAgent(
      mergeHeaders(
        { 'content-type': 'application/json' },
        this.config.headers(),
        options.headers,
      ),
    );

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (options.abortSignal?.aborted) throw error;
      throw new APICallError({
        message: `Cannot connect to API: ${error instanceof Error ? error.message : String(error)}`,
        url,
        requestBodyValues: body,
        cause: error,
        isRetryable: true,
      });
    }

    const responseHeaders = headersToRecord(response.headers);

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      const parsed = await parseErrorBody(responseBody);
      throw new APICallError({
        message: parsed.message ?? response.statusText ?? `HTTP ${response.status}`,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders,
        responseBody,
        data: parsed.data,
        isRetryable: isRetryable(response.status),
      });
    }

    let audio: Uint8Array;
    try {
      audio = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new APICallError({
        message: `Failed to read audio response: ${error instanceof Error ? error.message : String(error)}`,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders,
        cause: error,
        isRetryable: true,
      });
    }

    const metadata: JSONObject = {};
    const characterCount = Number(responseHeaders['x-character-count']);
    if (Number.isFinite(characterCount)) metadata.characterCount = characterCount;
    const sampleRate = Number(responseHeaders['x-sample-rate']);
    if (Number.isFinite(sampleRate)) metadata.sampleRate = sampleRate;
    if (responseHeaders['x-audio-format']) {
      metadata.audioFormat = responseHeaders['x-audio-format'];
    }

    return {
      audio,
      warnings,
      request: { body: JSON.stringify(body) },
      response: {
        timestamp,
        modelId: this.modelId,
        headers: responseHeaders,
      },
      providerMetadata: { readaloud: metadata },
    };
  }
}
