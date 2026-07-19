import "dotenv/config";

const apiKey = process.env.AI_API_KEY;
const baseUrl = process.env.AI_BASE_URL;
const model = process.env.AI_MODEL;

if (!apiKey) throw new Error("AI_API_KEY is missing");
if (!baseUrl) throw new Error("AI_BASE_URL is missing");
if (!model) throw new Error("AI_MODEL is missing");

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

export type AssistantMessage = {
    content: string;
    tool_calls: ModelToolCall[];
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
            description: "Read the content of a text file.",
            parameters: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "Absolute or relative file path" },
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

function createRequestBody(messages: ChatMessage[]) {
    return {
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
        stream: true,
    };
}

async function requestModelStream(messages: ChatMessage[]) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(createRequestBody(messages)),
    });

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

export async function callModelWithToolsStream(
    messages: ChatMessage[],
    handlers: StreamHandlers = {},
): Promise<AssistantMessage> {
    const response = await requestModelStream(messages);

    if (!response.body) {
        throw new Error("model stream body is not available");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let content = "";
    const toolCalls: ModelToolCall[] = [];

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
                };
            }

            const data = JSON.parse(payload);
            const choice = data?.choices?.[0];
            const delta = choice?.delta ?? {};

            if (typeof delta?.content === "string" && delta.content) {
                content += delta.content;
                await handlers.onContentDelta?.(delta.content);
            }

            if (Array.isArray(delta?.tool_calls)) {
                mergeToolCallDelta(toolCalls, delta.tool_calls);
            }
        }

        if (done) {
            break;
        }
    }

    return {
        content,
        tool_calls: finalizeToolCalls(toolCalls),
    };
}
