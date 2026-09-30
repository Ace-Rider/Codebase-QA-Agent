import { callModelWithToolsStream, type ChatMessage, type ModelToolCall } from "../lib/model.js";
import { normalizeResult } from "../tools/normalizeResult.js";
import { normalizeStep } from "../tools/format-step.js";
import { runTool } from "./run-tool.js";

export type Step = {
    iteration: number;
    status: "success" | "error";
    duration_ms: number;
    tool_name: string;
    tool_args: unknown;
    tool_result: unknown;
    tool_label?: string;
    status_label?: string;
    duration_text?: string;
    tool_args_text?: string;
    tool_result_text?: string;
    tool_result_full_text?: string;
    expandable?: boolean;
};

export type Citation = {
    file_path: string;
    source: "read_file" | "grep_files";
    line_number?: number;
    excerpt?: string;
    reason?: string;
};

export type TokenUsageSummary = {
    /** 最后一轮请求的上下文规模（prompt tokens） */
    prompt_tokens: number;
    /** 本轮全部生成消耗（completion tokens，跨迭代累计） */
    completion_tokens: number;
};

export type ChatResponse = {
    answer: string;
    steps: Step[];
    citations: Citation[];
    error: string | null;
    token_usage?: TokenUsageSummary | null;
};

export type StreamEvent =
    | { type: "status"; message: string }
    | { type: "answer_delta"; delta: string }
    | { type: "answer_reset" }
    | { type: "step"; step: Step }
    | { type: "final"; result: ChatResponse }
    | { type: "error"; error: string };

const SYSTEM_PROMPT =
    "You are a codebase assistant powered by Qwen. Never claim to be Claude, ChatGPT, or Anthropic. When the user asks about files, code, exports, functions, or project structure, use tools before answering. Keep going until you have enough information. " +
    "Reading strategy: for anything beyond small files, first use grep_files to locate the relevant line numbers, then read_file with offset/limit to read only that range instead of the whole file. Cite the file paths and line numbers you actually read.";

const MAX_ITERATIONS = 8;
const MAX_ITERATION_MESSAGE = "Agent 已达到最大迭代轮次，先返回当前可用结果。";
const STOPPED_MESSAGE = "已手动停止生成，以下是停止前得到的部分结果。";

// 上下文压缩：消息条数超过阈值时，把早期消息摘要成一条，只保留最近的完整消息
const COMPACT_THRESHOLD = 60;
const COMPACT_KEEP_RECENT = 24;
const COMPACT_SUMMARY_MAX_CHARS = 1200;
const COMPACT_TRANSCRIPT_MAX_CHARS = 60000;

const COMPACT_SYSTEM_PROMPT =
    "You compress conversation history for a codebase agent. Summarize the key facts: user questions, file paths examined, important findings and conclusions. Keep file paths and code identifiers verbatim. Drop verbose tool output. Reply with the summary only, under 300 words.";

function parseToolArgs(rawArguments: string) {
    try {
        return JSON.parse(rawArguments || "{}");
    } catch {
        return {};
    }
}

function createBaseMessages(): ChatMessage[] {
    return [
        {
            role: "system",
            content: SYSTEM_PROMPT,
        },
    ];
}

export function createMessagesForTurn(previousMessages: ChatMessage[] | undefined, userMessage: string) {
    const messages = previousMessages ? [...previousMessages] : createBaseMessages();
    messages.push({
        role: "user",
        content: userMessage,
    });
    return messages;
}

function createAssistantMessage(
    content: string,
    toolCalls: ModelToolCall[],
) {
    if (toolCalls.length === 0) {
        return {
            role: "assistant" as const,
            content,
        };
    }

    return {
        role: "assistant" as const,
        content,
        tool_calls: toolCalls,
    };
}

type ToolLoopContext = {
    iteration: number;
    messages: ChatMessage[];
    steps: Step[];
    onEvent: (event: Exclude<StreamEvent, { type: "final"; result: ChatResponse }>) => void | Promise<void>;
    signal?: AbortSignal | undefined;
};

/**
 * 执行本轮的全部工具调用：每个调用记录 Step、回填 tool 消息。
 * 工具出错不终止流程——错误作为工具结果回传给模型自行修正。
 * 返回 false 表示中途被中止（已执行的部分已保留在 steps/messages 里）。
 */
async function executeToolCalls(toolCalls: ModelToolCall[], context: ToolLoopContext): Promise<boolean> {
    const { iteration, messages, steps, onEvent, signal } = context;

    for (const toolCall of toolCalls) {
        if (signal?.aborted) {
            return false;
        }

        const toolName = toolCall.function.name;
        const toolArgs = parseToolArgs(toolCall.function.arguments || "{}");
        const startedAt = Date.now();

        await onEvent({ type: "status", message: `第 ${iteration} 轮：正在执行 ${toolName}` });

        try {
            const toolResult = await runTool(toolName, toolArgs);
            const durationMs = Date.now() - startedAt;

            const step: Step = {
                iteration,
                status: "success",
                duration_ms: durationMs,
                tool_name: toolName,
                tool_args: toolArgs,
                tool_result: toolResult,
            };

            steps.push(step);

            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult),
            });

            await onEvent({ type: "step", step: normalizeStep(step) });
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const message = error instanceof Error ? error.message : "tool execution failed";

            const errorStep: Step = {
                iteration,
                status: "error",
                duration_ms: durationMs,
                tool_name: toolName,
                tool_args: toolArgs,
                tool_result: { error: message },
            };

            steps.push(errorStep);
            await onEvent({ type: "step", step: normalizeStep(errorStep) });

            // 把错误作为工具结果回传给模型，让它自行修正参数后重试
            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: message }),
            });
        }
    }

    return true;
}

function serializeForSummary(message: ChatMessage): string {
    if (message.role === "assistant") {
        const calls = message.tool_calls
            ?.map((call) => `${call.function.name}(${(call.function.arguments ?? "").slice(0, 120)})`)
            .join(", ");
        const content = (message.content ?? "").slice(0, 400);
        return calls ? `[assistant] ${content} (tool calls: ${calls})` : `[assistant] ${content}`;
    }

    if (message.role === "tool") {
        return `[tool result] ${message.content.slice(0, 200)}`;
    }

    return `[${message.role}] ${message.content.slice(0, 400)}`;
}

/**
 * 上下文压缩：消息链过长时，把早期部分摘要成一条消息。
 * 切点必须是 user 消息的边界，避免把 assistant(tool_calls)/tool 配对截断导致 API 报错。
 * 压缩只影响本次请求的上下文，不改动调用方持有的完整消息链（库里仍存全量）。
 */
async function compactMessagesIfNeeded(
    messages: ChatMessage[],
    onEvent: (event: { type: "status"; message: string }) => void | Promise<void>,
    signal?: AbortSignal,
): Promise<ChatMessage[]> {
    if (messages.length <= COMPACT_THRESHOLD) {
        return messages;
    }

    // 从"保留最近 N 条"的窗口向后找第一个 user 消息作为安全切点
    const recentStart = Math.max(1, messages.length - COMPACT_KEEP_RECENT);
    let splitIndex = -1;

    for (let i = recentStart; i < messages.length; i++) {
        if (messages[i]?.role === "user") {
            splitIndex = i;
            break;
        }
    }

    if (splitIndex === -1) {
        return messages;
    }

    const older = messages.slice(1, splitIndex);

    if (older.length === 0) {
        return messages;
    }

    await onEvent({ type: "status", message: "上下文较长，正在压缩早期对话..." });

    try {
        const transcript = older.map(serializeForSummary).join("\n\n").slice(0, COMPACT_TRANSCRIPT_MAX_CHARS);
        const summaryResponse = await callModelWithToolsStream(
            [
                { role: "system", content: COMPACT_SYSTEM_PROMPT },
                { role: "user", content: `Compress this conversation history:\n\n${transcript}` },
            ],
            {},
            signal,
        );

        if (summaryResponse.aborted || !summaryResponse.content.trim()) {
            return messages;
        }

        const firstMessage = messages[0];
        const head = firstMessage?.role === "system" && firstMessage ? [firstMessage] : [];

        return [
            ...head,
            {
                role: "user" as const,
                content: `[earlier conversation summary]\n${summaryResponse.content.trim().slice(0, COMPACT_SUMMARY_MAX_CHARS)}`,
            },
            ...messages.slice(splitIndex),
        ];
    } catch {
        // 压缩失败不影响主流程，用原消息链继续
        return messages;
    }
}

export async function runAgentStream(
    messages: ChatMessage[],
    onEvent: (event: Exclude<StreamEvent, { type: "final"; result: ChatResponse }>) => void | Promise<void>,
    options: { signal?: AbortSignal } = {},
): Promise<ChatResponse> {
    const { signal } = options;
    const steps: Step[] = [];
    let lastStreamedAnswer = "";

    // 用量统计：prompt 取最后一轮（即最终上下文规模），completion 跨迭代累计
    let lastPromptTokens = 0;
    let totalCompletionTokens = 0;

    const collectUsage = (usage?: { prompt_tokens: number; completion_tokens: number }) => {
        if (!usage) {
            return;
        }

        lastPromptTokens = Math.max(lastPromptTokens, usage.prompt_tokens);
        totalCompletionTokens += usage.completion_tokens;
    };

    const buildUsage = (): TokenUsageSummary | null =>
        lastPromptTokens > 0 || totalCompletionTokens > 0
            ? { prompt_tokens: lastPromptTokens, completion_tokens: totalCompletionTokens }
            : null;

    const buildStoppedResult = () =>
        normalizeResult({
            answer: lastStreamedAnswer || "（已停止生成）",
            steps,
            citations: [],
            error: STOPPED_MESSAGE,
            token_usage: buildUsage(),
        });

    // 消息链过长时先压缩（只影响本次请求，库里仍存全量）
    messages = await compactMessagesIfNeeded(messages, onEvent, signal);

    await onEvent({ type: "status", message: "正在请求模型..." });

    for (let iterationIndex = 0; iterationIndex < MAX_ITERATIONS; iterationIndex++) {
        if (signal?.aborted) {
            return buildStoppedResult();
        }

        const iteration = iterationIndex + 1;
        let streamedAnswer = "";

        await onEvent({ type: "status", message: `第 ${iteration} 轮：正在请求模型` });

        const response = await callModelWithToolsStream(
            messages,
            {
                onContentDelta: async (delta) => {
                    streamedAnswer += delta;
                    await onEvent({ type: "answer_delta", delta });
                },
            },
            signal,
        );

        collectUsage(response.usage);

        if (streamedAnswer.trim()) {
            lastStreamedAnswer = streamedAnswer;
        }

        if (response.aborted) {
            messages.push(createAssistantMessage(response.content ?? "", []));
            return buildStoppedResult();
        }

        const toolCalls = response.tool_calls ?? [];
        messages.push(createAssistantMessage(response.content ?? "", toolCalls));

        if (toolCalls.length === 0) {
            await onEvent({ type: "status", message: "正在整理最终答案..." });

            return normalizeResult({
                answer: response.content ?? "",
                steps,
                citations: [],
                error: null,
                token_usage: buildUsage(),
            });
        }

        if (streamedAnswer.trim()) {
            await onEvent({ type: "answer_reset" });
        }

        await onEvent({
            type: "status",
            message: `第 ${iteration} 轮：模型决定调用 ${toolCalls.length} 个工具`,
        });

        const completed = await executeToolCalls(toolCalls, {
            iteration,
            messages,
            steps,
            onEvent,
            signal,
        });

        if (!completed) {
            return buildStoppedResult();
        }
    }

    return normalizeResult({
        answer: MAX_ITERATION_MESSAGE,
        steps,
        citations: [],
        error: null,
        token_usage: buildUsage(),
    });
}
