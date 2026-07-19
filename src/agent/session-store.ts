import type { Conversation, Message } from "@prisma/client";
import type { ChatResponse } from "./run-agent.js";
import { createMessagesForTurn } from "./run-agent.js";
import { prisma } from "../lib/prisma.js";
import type { ChatMessage, ModelToolCall } from "../lib/model.js";

export type ConversationHistoryItem = {
    id: string;
    title: string;
    message: string;
    answer: string;
    steps: ChatResponse["steps"];
    citations: ChatResponse["citations"];
    error: string | null;
    createdAt: string;
    updatedAt: string;
    isPending?: boolean;
};

type ConversationWithMessages = Conversation & {
    messages: Message[];
};

function buildConversationTitle(message: string) {
    const trimmed = message.trim().replace(/\s+/g, " ");

    if (!trimmed) {
        return "未命名会话";
    }

    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function toHistoryItem(conversation: Conversation): ConversationHistoryItem {
    return {
        id: conversation.id,
        title: conversation.title,
        message: conversation.message,
        answer: conversation.answer,
        steps: parseJson(conversation.stepsJson, []),
        citations: parseJson(conversation.citationsJson, []),
        error: conversation.error,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
    };
}

function toChatMessages(messages: Message[]): ChatMessage[] {
    return messages
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .reduce<ChatMessage[]>((items, message) => {
            if (message.role === "system" || message.role === "user") {
                items.push({
                    role: message.role,
                    content: message.content,
                });
                return items;
            }

            if (message.role === "assistant") {
                const toolCalls = parseJson<ModelToolCall[]>(message.toolCallsJson, []);

                if (toolCalls.length > 0) {
                    items.push({
                        role: "assistant",
                        content: message.content,
                        tool_calls: toolCalls,
                    });
                    return items;
                }

                items.push({
                    role: "assistant",
                    content: message.content,
                });
                return items;
            }

            if (message.role === "tool") {
                items.push({
                    role: "tool",
                    content: message.content,
                    tool_call_id: message.toolCallId ?? "",
                });
            }

            return items;
        }, []);
}

async function loadConversation(sessionId: string): Promise<ConversationWithMessages | null> {
    return prisma.conversation.findUnique({
        where: { id: sessionId },
        include: {
            messages: {
                orderBy: {
                    sortOrder: "asc",
                },
            },
        },
    });
}

export async function createSessionTurn(sessionId: string, userMessage: string) {
    const conversation = await loadConversation(sessionId);
    const previousMessages = conversation ? toChatMessages(conversation.messages) : undefined;
    const nextMessages = createMessagesForTurn(previousMessages, userMessage);

    await prisma.$transaction(async (tx) => {
        await tx.conversation.upsert({
            where: { id: sessionId },
            create: {
                id: sessionId,
                title: buildConversationTitle(userMessage),
                message: userMessage,
            },
            update: {
                message: userMessage,
            },
        });

        await tx.message.deleteMany({
            where: { conversationId: sessionId },
        });

        if (nextMessages.length > 0) {
            await tx.message.createMany({
                data: nextMessages.map((message, index) => ({
                    conversationId: sessionId,
                    role: message.role,
                    content: message.content,
                    toolCallId: message.role === "tool" ? message.tool_call_id : null,
                    toolCallsJson:
                        message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0
                            ? JSON.stringify(message.tool_calls)
                            : null,
                    sortOrder: index,
                })),
            });
        }
    });

    return nextMessages;
}

export async function saveSessionTurn(
    sessionId: string,
    userMessage: string,
    messages: ChatMessage[],
    result: ChatResponse,
) {
    await prisma.$transaction(async (tx) => {
        await tx.conversation.upsert({
            where: { id: sessionId },
            create: {
                id: sessionId,
                title: buildConversationTitle(userMessage),
                message: userMessage,
                answer: result.answer,
                error: result.error,
                stepsJson: JSON.stringify(result.steps),
                citationsJson: JSON.stringify(result.citations),
            },
            update: {
                message: userMessage,
                answer: result.answer,
                error: result.error,
                stepsJson: JSON.stringify(result.steps),
                citationsJson: JSON.stringify(result.citations),
            },
        });

        await tx.message.deleteMany({
            where: { conversationId: sessionId },
        });

        if (messages.length > 0) {
            await tx.message.createMany({
                data: messages.map((message, index) => ({
                    conversationId: sessionId,
                    role: message.role,
                    content: message.content,
                    toolCallId: message.role === "tool" ? message.tool_call_id : null,
                    toolCallsJson:
                        message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0
                            ? JSON.stringify(message.tool_calls)
                            : null,
                    sortOrder: index,
                })),
            });
        }
    });
}

export async function listConversations(limit = 12) {
    const conversations = await prisma.conversation.findMany({
        orderBy: {
            updatedAt: "desc",
        },
        take: limit,
    });

    return conversations.map(toHistoryItem);
}

export async function getConversationById(sessionId: string) {
    const conversation = await prisma.conversation.findUnique({
        where: { id: sessionId },
    });

    return conversation ? toHistoryItem(conversation) : null;
}
