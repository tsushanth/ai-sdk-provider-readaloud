# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-10-09

### Changed
- First release published from GitHub Actions with npm provenance (trusted publishing). No code changes.
- README no longer says the package is unpublished.

## [0.1.0] - 2026-10-09

### Added
- `createReadAloud()` and a default `readaloud` provider instance.
- `speech()` / `speechModel()` returning a `SpeechModelV4` for `generateSpeech()` (AI SDK 7).
- Options: `voice`, `speed` (0.25-4), `outputFormat` (`mp3`, `opus`, `wav`, `pcm`).
- Warnings for `instructions`, `language`, unsupported output formats and out-of-range speed.
- `APICallError` mapping for non-2xx responses (OpenAI-shaped error body, retryable status codes).
- `providerMetadata.readaloud` with `characterCount`, `sampleRate` and `audioFormat`.
- Unit tests with mocked fetch and a live integration test gated on `READALOUD_API_KEY`.
