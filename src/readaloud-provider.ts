import {
  LoadAPIKeyError,
  NoSuchModelError,
  type EmbeddingModelV4,
  type ImageModelV4,
  type LanguageModelV4,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  ReadAloudSpeechModel,
  type ReadAloudSpeechModelId,
} from './readaloud-speech-model.js';

export interface ReadAloudProviderSettings {
  /**
   * ReadAloud API key, sent as a Bearer token.
   * Defaults to the `READALOUD_API_KEY` environment variable.
   */
  apiKey?: string;
  /**
   * API base URL. Defaults to `https://api.readaloudai.org`.
   * A trailing `/v1` or `/` is accepted and removed.
   */
  baseURL?: string;
  /** Custom headers included in every request. */
  headers?: Record<string, string>;
  /** Custom fetch implementation (for proxies, tests, or edge runtimes). */
  fetch?: typeof fetch;
}

export interface ReadAloudProvider extends ProviderV4 {
  /** Creates a speech model. Alias of `.speech()`. */
  (modelId?: ReadAloudSpeechModelId): ReadAloudSpeechModel;
  /** Creates a speech model for `generateSpeech()`. */
  speech(modelId?: ReadAloudSpeechModelId): ReadAloudSpeechModel;
  /** Creates a speech model for `generateSpeech()` (AI SDK provider interface). */
  speechModel(modelId?: ReadAloudSpeechModelId): ReadAloudSpeechModel;
}

export const DEFAULT_BASE_URL = 'https://api.readaloudai.org';

function normalizeBaseURL(url: string | undefined): string {
  return (url ?? DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function createReadAloud(
  options: ReadAloudProviderSettings = {},
): ReadAloudProvider {
  const baseURL = normalizeBaseURL(options.baseURL);

  const getHeaders = (): Record<string, string | undefined> => {
    const apiKey = options.apiKey ?? process.env.READALOUD_API_KEY;
    if (!apiKey) {
      throw new LoadAPIKeyError({
        message:
          'ReadAloud API key is missing. Pass it with the `apiKey` parameter or set the READALOUD_API_KEY environment variable.',
      });
    }
    return { ...options.headers, authorization: `Bearer ${apiKey}` };
  };

  const createSpeechModel = (modelId: ReadAloudSpeechModelId = 'default') =>
    new ReadAloudSpeechModel(modelId, {
      provider: 'readaloud.speech',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider = function (modelId?: ReadAloudSpeechModelId) {
    return createSpeechModel(modelId);
  } as unknown as ReadAloudProvider;

  const unsupported = (modelType: 'languageModel' | 'embeddingModel' | 'imageModel') =>
    (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType,
        message: 'ReadAloud only provides speech models. Use readaloud.speech().',
      });
    };

  Object.assign(provider, {
    specificationVersion: 'v4' as const,
    speech: createSpeechModel,
    speechModel: createSpeechModel,
    languageModel: unsupported('languageModel') as (id: string) => LanguageModelV4,
    embeddingModel: unsupported('embeddingModel') as (id: string) => EmbeddingModelV4,
    imageModel: unsupported('imageModel') as (id: string) => ImageModelV4,
  });

  return provider;
}

/** Default provider instance. Reads `READALOUD_API_KEY` lazily at request time. */
export const readaloud = createReadAloud();
