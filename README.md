# Ask To Repo (Copilot CLI Proxy)

This app exposes a simple web interface and API so third parties can ask support questions about repositories your account can access. The backend lists accessible repositories, lets the user pick one, clones that repository locally, runs GitHub Copilot CLI in that mirror, and streams responses to the user.

The service now supports persistent chat sessions. Each chat stores message history and an associated Copilot session identifier so conversations can continue in both web UI and CLI resume flows.

## Current MVP status

- `GET /api/repos` lists repositories accessible by the configured token.
- `GET /api/models` lists available models and default model.
- `GET /api/chats` lists saved chats (optionally filtered by repository).
- `POST /api/chats` creates a new chat.
- `GET /api/chats/:chatId` fetches a chat and its messages.
- `POST /api/ask` streams answer events with Server-Sent Events (SSE).
- `GET /api/health` checks service health.
- Repository mirror manager does clone + fetch/reset per selected repo.
- Copilot CLI command and args are configurable via environment.

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
cp .env.example .env
```

3. Set required values in `.env`:

- Optional `GITHUB_API_TOKEN` for GitHub API calls (repo listing/clone). If omitted, app tries `gh auth token`.
- Optional `GITHUB_API_BASE_URL` for GitHub Enterprise environments
- Optional `COPILOT_DEFAULT_MODEL` (defaults to `gpt-5-mini`)
- Optional `COPILOT_AVAILABLE_MODELS_JSON` (allowed model picker values)
- Optional `COPILOT_ARGS_JSON` if your CLI invocation differs
- Optional `COPILOT_RESUME_ARGS_JSON` for continuing an existing Copilot session
- Optional `SESSIONS_FILE_PATH` to control where chats are persisted

4. Run development server:

```bash
npm run dev
```

5. Authenticate Copilot CLI once on the machine (required):

```bash
copilot -i "/login"
```

The app strips `GH_TOKEN`/`GITHUB_TOKEN`/`COPILOT_GITHUB_TOKEN` from the Copilot child process so CLI auth always comes from this device-flow login session.

6. Open:

- `http://localhost:8787`

## API

### `POST /api/ask`

Request body:

```json
{
  "chatId": "33cce987-2aeb-46c8-a6b8-74e3ea2dbef9",
  "repoFullName": "owner/repo",
  "model": "gpt-5-mini",
  "question": "How do I configure OAuth callback URLs?"
}
```

SSE response event format:

```json
{ "type": "status", "message": "Starting Copilot CLI session..." }
{ "type": "chunk", "content": "partial output..." }
{ "type": "error", "message": "..." }
{ "type": "done", "code": 0, "chatId": "...", "copilotSessionId": "..." }
```

### `POST /api/chats`

Request body:

```json
{
  "repoFullName": "owner/repo",
  "model": "gpt-5-mini",
  "title": "Investigate auth issue"
}
```

### `GET /api/chats`

Query params:

- `repoFullName` (optional) to list chats for a single repository

## Configuration notes

`COPILOT_ARGS_JSON` is interpreted as a JSON array with `{{prompt}}` placeholder substitution.

Example:

```env
COPILOT_ARGS_JSON=["--prompt","{{prompt}}","--reasoning-effort","medium","--allow-all-tools","--silent"]
COPILOT_RESUME_ARGS_JSON=["--prompt","{{prompt}}","--reasoning-effort","medium","--allow-all-tools","--silent","--resume","{{copilotSessionId}}"]
```

If your installed Copilot CLI uses a different command shape, update this value accordingly.

## Security notes

- Tokens remain server-side only.
- Output chunks are sanitized for common secret patterns.
- Response length is capped to avoid uncontrolled streaming.
- Rate limit is enabled on `/api/ask`.

## Next implementation steps

- Add session queue and worker pool caps
- Add explicit citations pipeline
- Add integration tests for stream robustness and policy enforcement
