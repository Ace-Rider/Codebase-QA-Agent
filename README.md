# Codebase QA Agent

A local codebase question-answering agent built from a frontend-first learning path.

It can inspect a project with tools, run a multi-round agent loop, stream intermediate progress to the browser, and render the final answer, citations, and tool steps in a structured React UI.

It also supports in-memory multi-turn conversation by session, plus a local conversation history sidebar in the frontend.

## What This Project Does

- Accepts natural language questions about the current codebase
- Lets the model decide when to call tools
- Supports four local tools:
  - `list_files`
  - `grep_files`
  - `read_file`
  - `read_multiple_files`
- Runs a multi-round tool-calling loop until the model has enough information
- Normalizes backend results into a stable frontend-friendly structure
- Supports session-based continuous conversation in memory
- Stores frontend conversation history in local storage
- Streams:
  - status updates
  - answer text deltas
  - tool step updates
  - final normalized result
- Renders:
  - Markdown answer
  - cited files
  - step-by-step tool execution cards
  - conversation history sidebar

## Why This Project Is Useful

This is not just a chat box connected to a model API.

It demonstrates several core AI agent engineering ideas:

- tool calling
- multi-round agent loops
- streaming answer output with SSE
- backend result normalization
- protocol conversion from model stream to UI event stream
- frontend visualization of intermediate steps
- source citation display for better answer traceability
- session continuity across multiple user turns

## Demo Flow

1. The user enters a question in the browser.
2. The frontend sends the question and `sessionId` to `POST /api/chat/stream`.
3. The backend appends the new user turn to that session's `messages`.
4. The model decides whether to answer directly or call tools.
5. If tool calls are returned:
   - the backend runs the tools
   - pushes tool results back into the conversation
   - records each tool step for the UI
6. During execution, the backend streams:
   - `status`
   - `answer_delta`
   - `step`
   - `final`
7. The frontend incrementally renders the answer and tool steps.
8. When the model stops calling tools, the backend returns the final normalized result.

## Tech Stack

- Node.js
- TypeScript
- Express
- Fast Glob
- OpenAI-compatible Chat Completions API
- React
- Vite
- SSE for streaming UI updates

## Response Shape

The backend returns a stable structure:

```ts
type ChatResponse = {
  answer: string;
  steps: Step[];
  citations: Citation[];
  error: string | null;
};
```

The streaming endpoint emits frontend-oriented events such as:

```ts
type StreamEvent =
  | { type: "status"; message: string }
  | { type: "answer_delta"; delta: string }
  | { type: "answer_reset" }
  | { type: "step"; step: Step }
  | { type: "final"; result: ChatResponse }
  | { type: "error"; error: string };
```

This keeps the frontend simple and avoids exposing raw model protocol details directly to the UI.

## Project Structure

```txt
src/
  index.ts
  lib/model.ts
  agent/run-agent.ts
  agent/run-tool.ts
  agent/session-store.ts
  tools/list-files.ts
  tools/read-file.ts
  tools/grep-files.ts
  tools/normalizeResult.ts
  tools/workspace.ts
web/
  index.html
  src/
    App.tsx
    components/
    hooks/
    services/
    types/
public/
  *.jpg / *.png assets for project explanation
```

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create a `.env` file

```env
AI_API_KEY=your_key
AI_BASE_URL=your_base_url
AI_MODEL=your_model_name
```

3. Start the development server

```bash
npm run dev
```

4. Open the React frontend in development

```txt
http://localhost:5173
```

5. Build both server and frontend

```bash
npm run build
```

6. Start the production server

```bash
npm start
```

7. Open the production app

```txt
http://localhost:3001
```

## Example Questions

- List the files under `src` and summarize the structure
- Read `src/agent/run-agent.ts` and explain how the loop works
- Search for `tool_choice` in `src` and explain where it is used
- Read `src/index.ts`, `src/lib/model.ts`, and `src/agent/run-agent.ts` together and explain the streaming flow
- Ask a follow-up question in the same session and observe that the agent remembers prior turns

## Resume-Friendly Highlights

- Built a codebase QA agent with multi-round tool calling over a local project
- Implemented file listing, keyword search, and file reading tools for codebase exploration
- Designed a backend normalization layer that returns answer, citations, and step metadata in a stable structure
- Converted raw model streaming output into frontend-oriented SSE events for answer, status, and step visualization
- Built a React frontend with Markdown rendering, cited file cards, step visualization, and conversation history
- Added in-memory session-based conversation continuity across multiple user turns

## Current Limitations

- No database-backed conversation persistence yet
- No semantic retrieval or vector search yet
- No approval workflow for sensitive actions yet
- Conversation history currently lives only in browser local storage
- Session memory is in-memory only and resets when the server restarts

## Good Next Steps

- Add database-backed session persistence
- Add semantic retrieval or lightweight indexing
- Add conversation summarization or context trimming for very long chats
- Add recording, screenshots, and architecture diagrams for portfolio use
