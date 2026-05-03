# UGC Discovery Pipeline

- **Description:** Automated pipeline to discover travel/history UGC creators on TikTok/Instagram by analyzing actual video content with local AI models (Whisper, Demucs, Qwen2.5-VL).
- **Stack:** Python, yt-dlp, Demucs, faster-whisper, Qwen2.5-VL via Ollama, Pydantic, SQLite
- **Status:** actively building (Phase 1 — video scoring MVP)
- **Content angles:**
  - Running AI vision models locally on Apple Silicon
  - Vocal isolation (Demucs) to fix Whisper transcription on noisy TikToks
  - Structured JSON output from local LLMs via Ollama + Pydantic
  - Automating creator discovery / UGC sourcing
  - Building data pipelines with local-first AI (no API costs)
