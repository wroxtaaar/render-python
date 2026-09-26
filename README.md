# SeedFlow — lightweight Render build

Small React + FastAPI app for direct 1337x search and Seedr cloud downloads.

## Architecture

Browser -> FastAPI -> 1337x / Seedr

No qBittorrent, Prowlarr, FlareSolverr, FFmpeg, local torrent storage, or media streaming.

## Environment

SEEDR_API_TOKEN=
SEEDR_LIBRARY_FOLDER_ID=88718944
SEEDR_MAX_SIZE_GB=5

Never commit a real Seedr token.

## Render

Deploy the main branch as a Docker Web Service. Render supplies PORT automatically.

Health check: /api/health
