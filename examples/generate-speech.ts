// Run: READALOUD_API_KEY=... npx tsx examples/generate-speech.ts [output.mp3]
import { writeFile } from 'node:fs/promises';
import { generateSpeech } from 'ai';
import { readaloud } from '../src/index.js'; // in your app: from 'ai-sdk-provider-readaloud'

const out = process.argv[2] ?? 'speech.mp3';

const result = await generateSpeech({
  model: readaloud.speech(),
  text: 'Hello from ReadAloud, called through the Vercel AI SDK.',
  voice: 'piper-default',
  outputFormat: 'mp3',
});

await writeFile(out, result.audio.uint8Array);
console.log(`wrote ${out}: ${result.audio.uint8Array.byteLength} bytes, ${result.audio.mediaType}`);
console.log('warnings:', result.warnings);
console.log('metadata:', result.providerMetadata.readaloud);
