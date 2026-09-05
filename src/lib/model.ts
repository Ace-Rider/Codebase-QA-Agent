import "dotenv/config";

/**
 * 环境变量在发请求时才读取与校验（而不是模块加载时），
 * 这样不配置 .env 的环境（如 CI）也能 import 本模块跑单测。
 */
function getModelConfig() {
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = process.env.AI_BASE_URL;
    const model = process.env.AI_MODEL;

    if (!apiKey) throw new Error("AI_API_KEY is missing");
    if (!baseUrl) throw new Error("AI_BASE_URL is missing");
    if (!model) throw new Error("AI_MODEL is missing");

    return { apiKey, baseUrl, model };
}

export type ChatMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string; tool_calls?: ModelToolCall[] }
    | { role: "tool"; content: string; tool_call_id: string };

export type ModelToolCall = {
    id: string;
    type?: "function";
    function: {
        name: string;
        arguments: string;
    };
};

export type TokenUsage = {
    prompt_tokens: number;
    completion_tokens: number;
};

export type AssistantMessage = {
    content: string;
    tool_calls: ModelToolCall[];
    /** 流被中止时为 true，content 是已生成的部分 */
    aborted?: boolean | undefined;
    /** 模型返回的用量信息（部分供应商在流的最后一个分片携带） */
    usage?: TokenUsage | undefined;
};

const tools = [
    {
        type: "function",
        function: {
            name: "list_files",
            description: "List files under a directory.",
            parameters: {
                type: "object",
                properties: {
                    rootDir: { type: "string", description: "Directory to inspect" },
                },
                required: ["rootDir"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description:
                "Read the content of a text file. For large files, pass offset/limit to read a line range instead of the whole file.",
            parameters: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "Absolute or relative file path" },
                    offset: {
                        type: "integer",
                        description: "1-based line number to start reading from (use with grep results)",
                    },
                    limit: {
                        type: "integer",
                        description: "Number of lines to read (default 100, max 400)",
                    },
                },
                required: ["filePath"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_multiple_files",
            description: "Read the content of multiple text files in one call. Use this when you need to compare or summarize several files together.",
            parameters: {
                type: "object",
                properties: {
                    filePaths: {
                        type: "array",
                        description: "A list of absolute or relative file paths",
                        items: { type: "string" },
                    },
                },
                required: ["filePaths"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "grep_files",
            description: "Search text in files under a directory and return matching lines.",
            parameters: {
                type: "object",
                properties: {
                    rootDir: { type: "string", description: "Directory to inspect" },
                    query: { type: "string", description: "Text to search for" },
                },
                required: ["rootDir", "query"],
                additionalProperties: false,
            },
        },
    },
];

type StreamHandlers = {
    onContentDelta?: (delta: string) => void | Promise<void>;
};

function createRequestBody(messages: ChatMessage[], includeUsage: boolean, model: string) {
    return {
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
        stream: true,
        // 让供应商在流的最后一个分片携带 usage 统计；个别网关不认识时降级重试
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    };
}

async function requestModelStream(messages: ChatMessage[], signal?: AbortSignal) {
    const { apiKey, baseUrl, model } = getModelConfig();

    const sendRequest = (includeUsage: boolean) =>
        fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(createRequestBody(messages, includeUsage, model)),
            ...(signal ? { signal } : {}),
        });

    let response = await sendRequest(true);

    if (response.status === 400) {
        // 可能是网关不支持 stream_options：去掉该参数重试一次
        response = await sendRequest(false);
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`model request failed: ${response.status} ${errorText}`);
    }

    return response;
}

function createEmptyToolCall(): ModelToolCall {
    return {
        id: "",
        type: "function",
        function: {
            name: "",
            arguments: "",
        },
    };
}

function mergeToolCallDelta(target: ModelToolCall[], deltaToolCalls: any[]) {
    for (const deltaToolCall of deltaToolCalls) {
        const index = typeof deltaToolCall?.index === "number" ? deltaToolCall.index : target.length;

        if (!target[index]) {
            target[index] = createEmptyToolCall();
        }

        const current = target[index];

        if (typeof deltaToolCall?.id === "string" && deltaToolCall.id) {
            current.id = deltaToolCall.id;
        }

        if (deltaToolCall?.type === "function") {
            current.type = "function";
        }

        if (typeof deltaToolCall?.function?.name === "string") {
            current.function.name += deltaToolCall.function.name;
        }

        if (typeof deltaToolCall?.function?.arguments === "string") {
            current.function.arguments += deltaToolCall.function.arguments;
        }
    }
}

function finalizeToolCalls(toolCalls: ModelToolCall[]) {
    return toolCalls.filter((toolCall) => toolCall && toolCall.function.name);
}

function getChunkPayload(chunk: string) {
    const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

    return dataLines.join("\n");
}

function parseChunkPayload(payload: string) {
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        // 丢弃无法解析的分片，避免单个坏分片导致整次请求失败
        return null;
    }
}

export async function callModelWithToolsStream(
    messages: ChatMessage[],
    handlers: StreamHandlers = {},
    signal?: AbortSignal,
): Promise<AssistantMessage> {
    let response: Response;

    try {
        response = await requestModelStream(messages, signal);
    } catch (error) {
        if (signal?.aborted) {
            return { content: "", tool_calls: [], aborted: true };
        }
        throw error;
    }

    if (!response.body) {
        throw new Error("model stream body is not available");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let content = "";
    const toolCalls: ModelToolCall[] = [];
    let usage: TokenUsage | undefined;

    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";

            for (const chunk of chunks) {
                const payload = getChunkPayload(chunk);

                if (!payload) {
                    continue;
                }

                if (payload === "[DONE]") {
                    return {
                        content,
                        tool_calls: finalizeToolCalls(toolCalls),
                        usage,
                    };
                }

                const data = parseChunkPayload(payload);

                if (!data || typeof data !== "object") {
                    continue;
                }

                // OpenAI 兼容流：开启 include_usage 后最后一个分片会带 usage 统计
                const chunkUsage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })
                    ?.usage;

                if (chunkUsage && typeof chunkUsage === "object") {
                    const promptTokens = Number(chunkUsage.prompt_tokens);
                    const completionTokens = Number(chunkUsage.completion_tokens);

                    if (Number.isFinite(promptTokens) && Number.isFinite(completionTokens)) {
                        usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens };
                    }
                }

                const choice = (data as { choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }> })
                    ?.choices?.[0];
                const delta = choice?.delta ?? {};

                if (typeof delta?.content === "string" && delta.content) {
                    content += delta.content;
                    await handlers.onContentDelta?.(delta.content);
                }

                if (Array.isArray(delta?.tool_calls)) {
                    mergeToolCallDelta(toolCalls, delta.tool_calls as any[]);
                }
            }

            if (done) {
                break;
            }
        }
    } catch (error) {
        if (signal?.aborted) {
            return { content, tool_calls: [], aborted: true, usage };
        }
        throw error;
    }

    return {
        content,
        tool_calls: finalizeToolCalls(toolCalls),
        usage,
    };
}
