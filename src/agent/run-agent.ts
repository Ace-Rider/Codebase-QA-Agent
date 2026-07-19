import { callModelWithToolsStream, type ChatMessage } from "../lib/model.js";
import { normalizeResult } from "../tools/normalizeResult.js";
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

export type ChatResponse = {
    answer: string;
    steps: Step[];
    citations: Citation[];
    error: string | null;
};

export type StreamEvent =
    | { type: "status"; message: string }
    | { type: "answer_delta"; delta: string }
    | { type: "answer_reset" }
    | { type: "step"; step: Step }
    | { type: "final"; result: ChatResponse }
    | { type: "error"; error: string };

const SYSTEM_PROMPT =
    "You are a codebase assistant powered by Qwen. Never claim to be Claude, ChatGPT, or Anthropic. When the user asks about files, code, exports, functions, or project structure, use tools before answering. Keep going until you have enough information.";
const MAX_ITERATIONS = 8;
const MAX_ITERATION_MESSAGE = "Agent 已达到最大迭代轮次，先返回当前可用结果。";

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

function normalizeSingleStep(step: Step) {
    return (
        normalizeResult({
            answer: "",
            steps: [step],
            citations: [],
            error: null,
        }).steps[0] ?? step
    );
}

function createAssistantMessage(
    content: string,
    toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
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

export async function runAgentStream(
    messages: ChatMessage[],
    onEvent: (event: Exclude<StreamEvent, { type: "final"; result: ChatResponse }>) => void | Promise<void>,
): Promise<ChatResponse> {
    const steps: Step[] = [];

    await onEvent({ type: "status", message: "正在请求模型..." });

    for (let iterationIndex = 0; iterationIndex < MAX_ITERATIONS; iterationIndex++) {
        const iteration = iterationIndex + 1;
        let streamedAnswer = "";

        await onEvent({ type: "status", message: `第 ${iteration} 轮：正在请求模型` });

        const response = await callModelWithToolsStream(messages, {
            onContentDelta: async (delta) => {
                streamedAnswer += delta;
                await onEvent({ type: "answer_delta", delta });
            },
        });

        const toolCalls = response.tool_calls ?? [];
        messages.push(createAssistantMessage(response.content ?? "", toolCalls));

        if (toolCalls.length === 0) {
            await onEvent({ type: "status", message: "正在整理最终答案..." });

            return normalizeResult({
                answer: response.content ?? "",
                steps,
                citations: [],
                error: null,
            });
        }

        if (streamedAnswer.trim()) {
            await onEvent({ type: "answer_reset" });
        }

        await onEvent({
            type: "status",
            message: `第 ${iteration} 轮：模型决定调用 ${toolCalls.length} 个工具`,
        });

        for (const toolCall of toolCalls) {
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

                await onEvent({ type: "step", step: normalizeSingleStep(step) });
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
                await onEvent({ type: "step", step: normalizeSingleStep(errorStep) });
                await onEvent({ type: "error", error: message });

                return normalizeResult({
                    answer: "",
                    steps,
                    citations: [],
                    error: message,
                });
            }
        }
    }

    return normalizeResult({
        answer: MAX_ITERATION_MESSAGE,
        steps,
        citations: [],
        error: null,
    });
}
