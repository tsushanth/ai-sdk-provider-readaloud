import { generateSpeech } from 'ai';
import { describe, expect, it } from 'vitest';
import { createReadAloud } from '../src/index.js';

const apiKey = process.env.READALOUD_API_KEY;
const live = apiKey ? describe : describe.skip;

// Hits the real ReadAloud gateway; skipped unless READALOUD_API_KEY is set.
live('live: ReadAloud gateway', () => {
  const provider = createReadAloud({ apiKey, baseURL: process.env.READALOUD_BASE_URL });
  const text = 'Hello from the AI SDK.';

  it('generates mp3 with piper-default', async () => {
    const res = await generateSpeech({ model: provider.speech('default'), text, voice: 'piper-default' });
    expect(res.audio.mediaType).toBe('audio/mpeg');
    expect(res.audio.uint8Array.byteLength).toBeGreaterThan(5_000);
    expect(res.warnings).toEqual([]);
    expect(res.providerMetadata.readaloud).toMatchObject({ characterCount: text.length });
  }, 60_000);

  it('generates wav with a RIFF header', async () => {
    const res = await generateSpeech({ model: provider.speech(), text, outputFormat: 'wav' });
    expect(res.audio.mediaType).toBe('audio/wav');
    const head = new TextDecoder().decode(res.audio.uint8Array.slice(0, 4));
    expect(head).toBe('RIFF');
  }, 60_000);

  it('generates opus (ogg) and raw pcm', async () => {
    const opus = await generateSpeech({ model: provider.speech(), text, outputFormat: 'opus' });
    expect(opus.audio.mediaType).toMatch(/^audio\/(ogg|opus)/);
    const pcm = await generateSpeech({ model: provider.speech(), text, outputFormat: 'pcm' });
    expect(pcm.audio.mediaType).toBe('audio/pcm');
    expect(pcm.audio.uint8Array.byteLength).toBeGreaterThan(10_000);
  }, 60_000);

  it('rejects a bad API key with a non-retryable 401', async () => {
    const bad = createReadAloud({ apiKey: 'rtts_invalid', baseURL: process.env.READALOUD_BASE_URL });
    await expect(generateSpeech({ model: bad.speech(), text, maxRetries: 0 })).rejects.toMatchObject({
      statusCode: 401,
      isRetryable: false,
    });
  }, 60_000);
});
