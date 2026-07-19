import type { ConversationHistoryItem, StreamEvent } from "../types/chat";

async function readErrorMessage(response: Response) {
    let errorMessage = `request failed: ${response.status}`;

    try {
        const data = await response.json();
        errorMessage = data.error || errorMessage;
    } catch {
        // Ignore non-JSON error bodies.
    }

    return errorMessage;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init);

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    return response.json() as Promise<T>;
}

export function fetchConversationHistory() {
    return requestJson<ConversationHistoryItem[]>("/api/conversations");
}

export function fetchConversation(sessionId: string) {
    return requestJson<ConversationHistoryItem>(`/api/conversations/${encodeURIComponent(sessionId)}`);
}

export async function requestChatStream(
    message: string,
    sessionId: string,
    onEvent: (event: StreamEvent) => void,
) {
    const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, sessionId }),
    });

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    if (!response.body) {
        throw new Error("stream body is not available");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (!line.startsWith("data:")) {
                    continue;
                }

                const payload = line.slice(5).trim();

                if (!payload) {
                    continue;
                }

                if (payload === "[DONE]") {
                    return;
                }

                onEvent(JSON.parse(payload) as StreamEvent);
            }
        }

        if (done) {
            break;
        }
    }
}
