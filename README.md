# @promptkit/sdk

Every AI call of your product through PromptKit: stored prompts, chats with tools and streaming, fallbacks
(e.g. your own Mac mini first, a cloud model when it's busy), images and videos, with the costs, logs, privacy and
guard managed in the PromptKit dashboard.

```bash
npm install github:promptkit-eu/sdk
```

```js
// .env: PROMPTKIT_API_KEY=pk_…  (PromptKit → Settings → API keys; switch on "Prompts written in code")
const AI = require("@promptkit/sdk");

// A stored prompt: its text, model, fallbacks and tools live in the dashboard
const summary = await AI.run("summarize-company", { company: "Acme" });

// A chat with tools, streaming
const answer = await AI.chat({
  model: "vertex/google/gemini-3-7-flash",
  fallbacks: ["mistral/mistral/large-4"],
  useTools: ["web_search"],
  messages: [{ role: "user", content: "What's new at Acme?" }],
  onText: (delta) => process.stdout.write(delta),
});

// A tool directly: a new project from a website
const site = await AI.runTool("website_data", { url: "acme.be" });
```

## From @autonomous-eu/llms

The functions and their results are the same: `generateText`, `generateJSON`, `generateWithTools`, `generateCode`,
`generateXML`, `generateImage`, `generateSuggestions` (and the text and code variants), `applySuggestions`,
`validateSuggestions`, `getModels`, `getModelInfo`, `estimateTokens`, `parseModelKey`. The model ids are the same too
(`vertex/google/gemini-3-7-flash`).

1. `npm uninstall @autonomous-eu/llms && npm install github:promptkit-eu/sdk`
2. Replace `require("@autonomous-eu/llms")` with `require("@promptkit/sdk")` (a credits wrapper that patches the
   module's functions keeps working: the module is a plain object).
3. Set `PROMPTKIT_API_KEY` in `.env` (and `.env.example`), and remove the provider keys (`GOOGLE_CLOUD_PROJECT`,
   `GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_API_KEY`, …): PromptKit holds them.
4. Pass `tag` (your customer's or workspace's id) so PromptKit shows usage per customer and sends it as the userId to
   your EventsLake.

What's different:

- `cost` and `totalCost` are what PromptKit charged, in **euro** (llms reported the provider's USD price). Tokens are
  the same.
- `getModels()` answers the list loaded last: call `await AI.listModels()` once at start (llms' list was built in).
- Errors come back in `error` like before, now with `errorCode` (`no_balance`, `rate_limit`, `adhoc_not_allowed`,
  `timeout`, `network`, …) and `status`.
- `maxTries` is accepted but PromptKit retries and falls back itself (`fallbacks: [...]`).
