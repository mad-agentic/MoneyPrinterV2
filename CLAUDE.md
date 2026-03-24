# CLAUDE.md

This file provides guidance to Claude Opus (claude.ai/code) when working with code in this repository.

## Project Overview

MoneyPrinterV2 is a Python 3.12 CLI automation tool with 4 workflows:
1. YouTube Shorts generation + upload
2. Twitter/X post generation + publishing
3. Amazon affiliate pitch generation + posting to Twitter
4. Local business scraping + outreach email sending

It is a terminal app (no web API/UI).

## Commands You’ll Actually Use

```bash
# Initial setup
cp config.example.json config.json
python -m venv venv
source venv/bin/activate          # Windows: .\\venv\\Scripts\\activate
pip install -r requirements.txt

# Optional macOS helper (sets up local defaults)
bash scripts/setup_local.sh

# Validate local dependencies/config reachability
python scripts/preflight_local.py

# Run interactive CLI (must be run from repo root)
python src/main.py

# Run headless scheduled job directly
python src/cron.py twitter <account_uuid> <ollama_model>
python src/cron.py youtube <account_uuid> <ollama_model>

# Convenience script (interactive account selection)
bash scripts/upload_video.sh
```

## Build / Lint / Test Status

- There is no build system for this repo.
- There is currently no lint configuration.
- There is currently no test suite, so there is no single-test command.

If you add tests/linting in future work, update this file with exact commands.

## Architecture (Big Picture)

### Entry points and control flow
- `src/main.py`: interactive menu loop; selects active Ollama model, manages accounts/products, and calls workflow classes.
- `src/cron.py`: non-interactive runner for scheduled posting/uploading; expects args:
  - `<platform>` (`twitter` or `youtube`)
  - `<account_uuid>`
  - `<ollama_model>` (required in current implementation)

In-app scheduling uses Python `schedule` and spawns subprocesses of `src/cron.py`.

### Core module responsibilities
- `src/classes/YouTube.py`: main pipeline orchestration (topic/script/metadata → prompts/images → TTS → subtitles/video composition → Selenium upload).
- `src/classes/Twitter.py`: generates post text and publishes via Selenium on `x.com`.
- `src/classes/AFM.py`: scrapes Amazon product info, generates pitch via LLM, publishes via Twitter class.
- `src/classes/Outreach.py`: downloads/builds Go Google Maps scraper, extracts websites/emails, sends outreach via SMTP (`yagmail`).
- `src/classes/Tts.py`: KittenTTS wrapper.
- `src/llm_provider.py`: Ollama client wrapper (`list_models`, `select_model`, `generate_text`); model selection is process-global.
- `src/config.py`: config getters from `config.json` (re-reads file on each call; no central cached config object).
- `src/cache.py`: JSON persistence for accounts, posts, videos, products.

### Persistence model
- Runtime state is stored in `.mp/` as JSON files:
  - `youtube.json`, `twitter.json`, `afm.json`
- `.mp/` also stores temporary generated media; temp cleanup removes non-JSON files.

### Important integration constraints
- Selenium automation assumes Firefox profiles are already authenticated.
- Image/subtitle path depends on ImageMagick configured in `config.json`.
- LLM is local Ollama (configured by `ollama_base_url` and `ollama_model`).
- Image generation uses Nano Banana 2 / Gemini image endpoint config.
- Outreach requires Go installed locally to build/run scraper binary.

## Working Rules for This Codebase

- Run commands from project root (`python src/main.py`), because imports and `ROOT_DIR` assumptions depend on this.
- Keep import style consistent with existing code (`from config import ...`, not `from src.config import ...`).
- Prefer extending existing workflow classes/modules over introducing new abstractions.
- When changing scheduling behavior, update both interactive scheduler logic (`main.py`) and direct cron behavior (`cron.py`) if needed.