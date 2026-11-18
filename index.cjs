/**
 * @promptkit/sdk: every AI call of a product goes through PromptKit (prompts, models, fallbacks, tools, privacy,
 * costs and logs are managed in the dashboard). A drop-in for @autonomous-eu/llms: the same functions and result
 * fields (generateText, generateJSON, generateWithTools, generateCode, generateXML, generateImage, the suggestions,
 * getModels, estimateTokens), plus PromptKit's own: run (a stored prompt), chat (streaming, tools), runTool,
 * generateVideo / getVideo and feedback.
 *
 * Configure with PROMPTKIT_API_KEY (and PROMPTKIT_URL for another PromptKit), or configure({ apiKey, baseUrl }).
 * The key needs "Prompts written in code" for everything except run().
 *
 * Results never throw for a model error: they carry `error`, like llms. Network and refusal errors (no key, the
 * guard, an empty balance) also come back as `error`, with `errorCode` (e.g. "no_balance") and `status`.
 */
const { applySuggestions, validateSuggestions } = require("./suggestions.cjs");

const VERSION = "0.1.0";
const settings = {
  apiKey: process.env.PROMPTKIT_API_KEY || "",
  baseUrl: (process.env.PROMPTKIT_URL || "https://app.promptkit.eu/api").replace(/\/+$/, ""),
  timeoutMs: Number(process.env.PROMPTKIT_TIMEOUT_MS) || 10 * 60_000,
  retries: 2,
  tag: null,
  fetch: (...a) => globalThis.fetch(...a),
};

/** Change the key, address, timeout, a default tag (e.g. your customer's id) or the fetch function. */
function configure(options = {}) {
  for (const k of ["apiKey", "timeoutMs", "retries", "tag", "fetch"]) if (options[k] !== undefined) settings[k] = options[k];
  if (options.baseUrl) settings.baseUrl = options.baseUrl.replace(/\/+$/, "");
  models.cache = null;
  return { ...settings, apiKey: settings.apiKey ? `${settings.apiKey.slice(0, 9)}…` : "" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);

/** One request to PromptKit: JSON in, JSON out. Never throws: { ok, status, data } or { ok: false, error }. */
async function request(method, path, body, opts = {}) {
  if (!settings.apiKey) return { ok: false, status: 0, data: null, error: "Set PROMPTKIT_API_KEY (PromptKit → Settings → API keys)", errorCode: "no_key" };
  let last = null;
  for (let attempt = 0; attempt <= settings.retries; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
    try {
      const res = await settings.fetch(`${settings.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json", "user-agent": `promptkit-sdk/${VERSION}`, ...(opts.stream && { accept: "text/event-stream" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(settings.timeoutMs)]) : AbortSignal.timeout(settings.timeoutMs),
      });
      if (opts.raw && res.ok) return { ok: true, status: res.status, res };
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { error: text.slice(0, 300) };
      }
      if (res.ok) return { ok: true, status: res.status, data };
      last = { ok: false, status: res.status, data, error: data?.error || `PromptKit answered ${res.status}`, errorCode: data?.code };
      // Only retry what may work the second time (never a refusal by the guard)
      if (!RETRY.has(res.status) || data?.code) return last;
    } catch (e) {
      last = { ok: false, status: 0, data: null, error: e.name === "TimeoutError" ? "PromptKit didn't answer in time" : `Couldn't reach PromptKit: ${e.message}`, errorCode: e.name === "TimeoutError" ? "timeout" : "network" };
      if (e.name === "AbortError") return last;
    }
  }
  return last;
}

/** The llms-style fields of an answer. */
function result(r, extra = {}) {
  if (!r.ok) return { error: r.error, errorCode: r.errorCode, status: r.status, text: "", data: null, inputTokens: 0, outputTokens: 0, usedTokens: 0, cost: 0, totalCost: 0 };
  const d = r.data;
  return {
    id: d.id,
    text: d.output ?? "",
    data: d.json ?? d.output ?? "",
    ...(d.json !== undefined && { json: d.json }),
    error: d.error ?? null,
    model: d.model,
    fallbacks: d.fallbacks ?? [],
    inputTokens: d.inputTokens ?? 0,
    outputTokens: d.outputTokens ?? 0,
    usedTokens: (d.inputTokens ?? 0) + (d.outputTokens ?? 0),
    // What PromptKit charged, in euro (llms reported the provider's USD price)
    cost: d.cost ?? 0,
    totalCost: d.cost ?? 0,
    currency: "EUR",
    durationMs: d.durationMs,
    ...extra,
  };
}

const imagesOf = (config) => [...(config.images ?? []), ...(config.image ? [`data:image/png;base64,${config.image}`] : [])];
const system = (config) => config.systemInstruction ?? config.system;

async function generate(config, output) {
  if (!config?.prompt) return { error: "prompt is required", text: "", data: null };
  if (!config.model) return { error: "model is required (e.g. 'vertex/google/gemini-3-7-flash')", text: "", data: null };
  const schemaHint = config.schema ? `\n\nAnswer with JSON that follows this JSON Schema:\n${JSON.stringify(config.schema)}` : "";
  const r = await request(
    "POST",
    "/v1/generate",
    {
      model: config.model,
      fallbacks: config.fallbacks ?? [],
      prompt: config.prompt,
      ...(system(config) || schemaHint ? { system: `${system(config) ?? ""}${schemaHint}`.trim() } : {}),
      images: imagesOf(config).length ? imagesOf(config) : undefined,
      output,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      useTools: config.useTools,
      tag: config.tag ?? settings.tag ?? undefined,
    },
    { signal: config.signal },
  );
  return r;
}

const generateText = async (config) => result(await generate(config, "text"));
const generateJSON = async (config) => {
  const r = result(await generate(config, config?.type === "array" ? "array" : "object"));
  return r.error ? r : { ...r, json: r.json ?? r.data };
};
const generateCode = async (config) => {
  const r = result(await generate(config, "code"));
  return { ...r, code: r.text };
};
const generateXML = async (config) => {
  const r = result(await generate(config, "xml"));
  return { ...r, xml: r.text };
};

// ── Chats and tools ─────────────────────────────────────────────────────────────────────────────────────────────

/** Reads server-sent events from a fetch Response, calling onEvent for each; resolves with the `done` answer. */
async function readEvents(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = null;
  let failed = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = block.match(/^event: ?(.*)$/m)?.[1] ?? "message";
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "done") done = json;
      else if (event === "error") failed = json;
      else onEvent?.(json);
    }
  }
  return done ? { ok: true, status: 200, data: done } : { ok: false, status: failed?.status ?? 500, data: failed, error: failed?.error ?? "The stream ended without an answer", errorCode: failed?.code };
}

async function post(path, body, opts) {
  if (!body.stream) return request("POST", path, body, opts);
  const r = await request("POST", path, body, { ...opts, stream: true, raw: true });
  if (!r.ok || !r.res) return r;
  return readEvents(r.res, (e) => {
    if (e.type === "text") opts.onText?.(e.delta);
    opts.onEvent?.(e);
  });
}

// The chat a conversation belongs to rides along on its assistant messages, so a tool loop stays one chat
const CHAT = "promptkitChatId";

/**
 * A chat turn: on a stored prompt (`prompt`) or written in code (`model`, `system`). The project's tools in
 * `useTools` run in PromptKit; your `tools` come back in `toolCalls`. `stream: true` with `onText` / `onEvent`.
 */
async function chat(config) {
  const chatId = config.chatId ?? [...(config.messages ?? [])].reverse().find((m) => m?.[CHAT])?.[CHAT];
  const r = await post(
    "/v1/chat",
    {
      prompt: config.prompt,
      variables: config.variables,
      chatId,
      messages: (config.messages ?? []).map(({ [CHAT]: _c, ...m }) => m),
      system: system(config),
      model: config.model,
      fallbacks: config.fallbacks,
      useTools: config.useTools,
      tools: config.tools,
      output: config.output,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      tag: config.tag ?? settings.tag ?? undefined,
      stream: !!config.stream || !!config.onText || !!config.onEvent,
    },
    { signal: config.signal, onText: config.onText, onEvent: config.onEvent },
  );
  if (!r.ok) return result(r, { toolCalls: [], message: null });
  const d = r.data;
  return {
    ...result(r),
    chatId: d.chatId,
    toolCalls: d.toolCalls ?? [],
    message: d.message ? { ...d.message, [CHAT]: d.chatId } : null,
  };
}

/** llms' generateWithTools: the same conversation format (user, assistant with toolCalls and raw, tool with results). */
async function generateWithTools(config) {
  if (!config) return { error: "No input received" };
  if (!Array.isArray(config.tools)) return { error: "tools is required: [{ name, description, inputSchema }]" };
  if (!config.model) return { error: "model is required (e.g. 'vertex/google/gemini-3-8-flash')" };
  const messages = config.messages?.length ? config.messages : [{ role: "user", content: config.prompt, ...(imagesOf(config).length && { images: imagesOf(config) }) }];
  const r = await chat({ ...config, messages, prompt: undefined });
  return { ...r, data: r.text };
}

/** A stored prompt by its key, with its variables (and images): its live version, model, fallbacks and tools. */
async function run(prompt, variables = {}, opts = {}) {
  const r = await post(`/v1/prompts/${encodeURIComponent(prompt)}/run`, { variables, images: opts.images, version: opts.version, model: opts.model, tag: opts.tag ?? settings.tag ?? undefined, stream: !!opts.stream || !!opts.onText }, opts);
  return result(r, r.ok ? { version: r.data.version, toolCalls: r.data.toolCalls } : {});
}

/** One of the project's tools, directly (e.g. runTool("website_data", { url: "acme.be" })). */
async function runTool(name, input = {}, opts = {}) {
  const r = await request("POST", `/v1/tools/${encodeURIComponent(name)}/run`, { input, model: opts.model, tag: opts.tag ?? settings.tag ?? undefined }, opts);
  if (!r.ok) return { ok: false, error: r.error, errorCode: r.errorCode, output: "" };
  return { ...r.data, error: r.data.ok ? null : r.data.output };
}

/** Scores a run or a chat: good, medium or bad, with an optional note. */
async function feedback(id, score, note, kind = "run") {
  const r = await request("POST", kind === "chat" ? `/v1/chats/${id}/feedback` : `/v1/runs/${id}/feedback`, { score, feedback: note });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ── Images, videos and suggestions ───────────────────────────────────────────────────────────────────────────────

async function file(url) {
  const r = await request("GET", url, undefined, { raw: true });
  if (!r.ok) return null;
  const mime = r.res.headers.get("content-type") ?? "application/octet-stream";
  const data = Buffer.from(await r.res.arrayBuffer()).toString("base64");
  return { mime, data };
}

/** llms' generateImage: { imageData (base64), mimeType, data (a data URI) }, and `images` when count > 1. */
async function generateImage(config) {
  if (!config?.prompt) return { error: "prompt is required" };
  const params = config.imageParams ?? {};
  const r = await request("POST", "/v1/images", { model: config.model, prompt: config.prompt, count: params.count ?? config.count ?? 1, aspectRatio: params.aspectRatio ?? config.aspectRatio, images: config.images, tag: config.tag ?? settings.tag ?? undefined });
  if (!r.ok) return result(r);
  if (!r.data.images?.length) return { error: r.data.error ?? "No image", cost: r.data.cost };
  const files = (await Promise.all(r.data.images.map((i) => file(i.url)))).filter(Boolean);
  const first = files[0];
  return { id: r.data.id, imageData: first?.data, mimeType: first?.mime, data: first ? `data:${first.mime};base64,${first.data}` : null, images: files.map((f) => `data:${f.mime};base64,${f.data}`), cost: r.data.cost, totalCost: r.data.cost, currency: "EUR", error: null };
}

/** Starts a video; with `wait: true` it polls until it's ready (minutes). */
async function generateVideo(config) {
  const r = await request("POST", "/v1/videos", { model: config.model, prompt: config.prompt, seconds: config.seconds, aspectRatio: config.aspectRatio, audio: config.audio, image: config.image, tag: config.tag ?? settings.tag ?? undefined });
  if (!r.ok) return result(r);
  if (!config.wait) return r.data;
  for (;;) {
    await sleep(config.pollMs ?? 10_000);
    const v = await getVideo(r.data.id);
    if (v.status !== "running") return { ...v, cost: r.data.cost };
  }
}
async function getVideo(id) {
  const r = await request("GET", `/v1/videos/${id}`);
  if (!r.ok) return { id, status: "error", error: r.error };
  if (r.data.status !== "ok") return r.data;
  const f = await file(r.data.url);
  return { ...r.data, videoData: f?.data, mimeType: f?.mime };
}

async function suggestions(config, kind) {
  const r = await request("POST", "/v1/suggestions", { model: config.model, text: config.text ?? config.code ?? "", instruction: config.prompt ?? config.instruction, kind, maxTokens: config.maxTokens, tag: config.tag ?? settings.tag ?? undefined });
  if (!r.ok) return { ...result(r), suggestions: [] };
  return { success: !r.data.error, suggestions: r.data.suggestions ?? [], applied: r.data.applied, error: r.data.error, cost: r.data.cost, totalCost: r.data.cost, id: r.data.id };
}
const generateSuggestions = (config) => suggestions(config, "text");
const generateTextSuggestions = (config) => suggestions(config, "text");
const generateCodeSuggestions = (config) => suggestions(config, "code");

// ── Models ───────────────────────────────────────────────────────────────────────────────────────────────────────

const models = { cache: null, at: 0 };
/** The models this key can use (from PromptKit, cached for 10 minutes). */
async function listModels() {
  if (models.cache && Date.now() - models.at < 600_000) return models.cache;
  const r = await request("GET", "/v1/models");
  if (r.ok) {
    models.cache = r.data;
    models.at = Date.now();
  }
  return models.cache ?? [];
}
/** llms' getModels() was synchronous: this answers the last loaded list (call listModels() once at start). */
const getModels = () => models.cache ?? [];
const getModelInfo = (id) => getModels().find((m) => m.id === id) ?? null;
const getModelKeys = () => getModels().map((m) => m.id);
const parseModelKey = (key) => {
  const [provider, publisher, ...rest] = String(key).split("/");
  return { provider, publisher, model: rest.join("/") };
};
const estimateTokens = (text) => (text ? Math.ceil(String(text).length / 4) : 0);

module.exports = {
  VERSION,
  configure,
  // PromptKit
  run,
  chat,
  runTool,
  feedback,
  generateVideo,
  getVideo,
  listModels,
  // The same as @autonomous-eu/llms
  generateText,
  generateJSON,
  generateWithTools,
  generateCode,
  generateXML,
  generateImage,
  generateSuggestions,
  generateTextSuggestions,
  generateCodeSuggestions,
  applySuggestions,
  validateSuggestions,
  getModels,
  getModelInfo,
  getModelKeys,
  parseModelKey,
  estimateTokens,
};
