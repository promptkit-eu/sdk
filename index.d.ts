export type ToolDef = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type Message =
  | { role: "user"; content: string; images?: string[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: unknown; promptkitChatId?: string }
  | { role: "tool"; results: { id: string; name: string; content: string; isError?: boolean }[] };

export interface Result {
  id?: string;
  text: string;
  data: unknown;
  json?: unknown;
  error: string | null;
  /** e.g. no_key, no_balance, rate_limit, adhoc_not_allowed, timeout, network */
  errorCode?: string;
  status?: number;
  model?: string;
  /** Models tried before the one that answered */
  fallbacks?: { model: string; error: string }[];
  inputTokens: number;
  outputTokens: number;
  usedTokens: number;
  /** What PromptKit charged, in euro */
  cost: number;
  totalCost: number;
  currency?: "EUR";
  durationMs?: number;
}

export interface GenerateConfig {
  model: string;
  prompt: string;
  /** Tried in order when the model is busy, offline, too slow or fails */
  fallbacks?: string[];
  systemInstruction?: string;
  system?: string;
  /** Data URIs (data:image/png;base64,…) or https addresses */
  images?: string[];
  image?: string;
  maxTokens?: number;
  temperature?: number;
  /** The project's tools to use, e.g. ["web_search"] */
  useTools?: string[];
  /** Your own label, e.g. your customer's id: usage per tag, and the userId in your EventsLake */
  tag?: string;
  signal?: AbortSignal;
  /** Accepted for llms compatibility; PromptKit retries itself */
  maxTries?: number;
}

export interface ChatConfig {
  prompt?: string;
  variables?: Record<string, unknown>;
  model?: string;
  fallbacks?: string[];
  system?: string;
  systemInstruction?: string;
  chatId?: string;
  messages: Message[];
  tools?: ToolDef[];
  useTools?: string[];
  output?: "text" | "markdown" | "object" | "array" | "code" | "xml";
  maxTokens?: number;
  temperature?: number;
  tag?: string;
  stream?: boolean;
  onText?: (delta: string) => void;
  onEvent?: (event: { type: string; [k: string]: unknown }) => void;
  signal?: AbortSignal;
}
export interface ChatResult extends Result {
  chatId?: string;
  /** Calls to your own tools: run them and send the results as { role: "tool", results } */
  toolCalls: ToolCall[];
  /** The assistant turn to append to messages */
  message: Message | null;
}

export function configure(options: { apiKey?: string; baseUrl?: string; timeoutMs?: number; retries?: number; tag?: string | null; fetch?: typeof fetch }): Record<string, unknown>;
export function run(prompt: string, variables?: Record<string, unknown>, opts?: { images?: string[]; version?: number; model?: string; tag?: string; stream?: boolean; onText?: (d: string) => void; signal?: AbortSignal }): Promise<Result & { version?: number; toolCalls?: number }>;
export function chat(config: ChatConfig): Promise<ChatResult>;
export function runTool(name: string, input?: Record<string, unknown>, opts?: { model?: string; tag?: string }): Promise<{ id?: string; ok: boolean; output: string; json?: any; durationMs?: number; cost?: number; error: string | null; errorCode?: string }>;
export function feedback(id: string, score: "good" | "medium" | "bad", note?: string, kind?: "run" | "chat"): Promise<{ ok: boolean; error?: string }>;
export function generateText(config: GenerateConfig): Promise<Result>;
export function generateJSON(config: GenerateConfig & { type?: "object" | "array"; schema?: Record<string, unknown> }): Promise<Result & { json?: any }>;
export function generateCode(config: GenerateConfig): Promise<Result & { code: string }>;
export function generateXML(config: GenerateConfig): Promise<Result & { xml: string }>;
export function generateWithTools(config: Omit<ChatConfig, "messages"> & { model: string; tools: ToolDef[]; messages?: Message[]; prompt?: string; images?: string[] }): Promise<ChatResult>;
export function generateImage(config: { model: string; prompt: string; count?: number; aspectRatio?: string; images?: string[]; imageParams?: { count?: number; aspectRatio?: string }; tag?: string }): Promise<{ id?: string; imageData?: string; mimeType?: string; data?: string | null; images?: string[]; cost?: number; error: string | null }>;
export function generateVideo(config: { model: string; prompt: string; seconds?: number; aspectRatio?: "16:9" | "9:16"; audio?: boolean; image?: string; tag?: string; wait?: boolean; pollMs?: number }): Promise<{ id: string; status: string; cost?: number; videoData?: string; mimeType?: string; error?: string | null }>;
export function getVideo(id: string): Promise<{ id: string; status: string; url?: string | null; videoData?: string; mimeType?: string; error?: string | null }>;
export function generateSuggestions(config: { model: string; prompt: string; text?: string; maxTokens?: number; tag?: string }): Promise<{ success: boolean; suggestions: unknown[]; applied?: string | null; error?: string | null; cost?: number }>;
export function generateTextSuggestions(config: { model: string; prompt: string; text?: string; maxTokens?: number; tag?: string }): ReturnType<typeof generateSuggestions>;
export function generateCodeSuggestions(config: { model: string; prompt: string; code?: string; text?: string; maxTokens?: number; tag?: string }): ReturnType<typeof generateSuggestions>;
export function applySuggestions(config: { text: string; suggestions: unknown[]; validateUniqueness?: boolean; strict?: boolean; handleDependencies?: boolean }): { success: boolean; correctedText: string; applied: unknown[]; failed: unknown[]; skipped: unknown[] };
export function validateSuggestions(text: string, suggestions: unknown[]): unknown;
export function listModels(): Promise<{ id: string; name: string; provider: string; inputEurPerM: number; outputEurPerM: number; contextWindow: number | null; capabilities: string[]; warning?: string }[]>;
export function getModels(): Awaited<ReturnType<typeof listModels>>;
export function getModelInfo(id: string): Awaited<ReturnType<typeof listModels>>[number] | null;
export function getModelKeys(): string[];
export function parseModelKey(key: string): { provider: string; publisher: string; model: string };
export function estimateTokens(text: string): number;
export const VERSION: string;
