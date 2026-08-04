import type { Conversation, Message, Turn } from "@prisma/client";
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

export type TurnHistoryItem = {
    id: string;
    question: string;
    answer: string;
    steps: ChatResponse["steps"];
    citations: ChatResponse["citations"];
    error: string | null;
    token_usage: ChatResponse["token_usage"];
    createdAt: string;
};

export type ConversationDetail = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turns: TurnHistoryItem[];
};

export type SessionTurnContext = {
    messages: ChatMessage[];
    savedMessageCount: number;
};

type ConversationWithMessages = Conversation & {
    messages: Message[];
};

type ConversationWithTurns = Conversation & {
    turns: Turn[];
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

function toTurnHistoryItem(turn: Turn): TurnHistoryItem {
    return {
        id: turn.id,
        question: turn.question,
        answer: turn.answer,
        steps: parseJson(turn.stepsJson, []),
        citations: parseJson(turn.citationsJson, []),
        error: turn.error,
        token_usage: turn.tokenUsageJson ? parseJson(turn.tokenUsageJson, null) : null,
        createdAt: turn.createdAt.toISOString(),
    };
}

function toMessageData(conversationId: string, message: ChatMessage, sortOrder: number) {
    return {
        conversationId,
        role: message.role,
        content: message.content,
        toolCallId: message.role === "tool" ? message.tool_call_id : null,
        toolCallsJson:
            message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0
                ? JSON.stringify(message.tool_calls)
                : null,
        sortOrder,
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

export async function createSessionTurn(sessionId: string, userMessage: string): Promise<SessionTurnContext> {
    const conversation = await loadConversation(sessionId);
    const previousMessages = conversation ? toChatMessages(conversation.messages) : undefined;
    const nextMessages = createMessagesForTurn(previousMessages, userMessage);
    const savedMessageCount = (conversation?.messages.length ?? 0) + 1;

    await prisma.$transaction(async (tx) => {
        await tx.conversation.upsert({
            where: { id: sessionId },
            create: {
                id: sessionId,
                title: buildConversationTitle(userMessage),
                message: userMessage,
            },
            // 标题只在创建时生成，追加轮次时不覆盖
            update: {
                message: userMessage,
            },
        });

        await tx.message.create({
            data: toMessageData(
                sessionId,
                {
                    role: "user",
                    content: userMessage,
                },
                savedMessageCount - 1,
            ),
        });
    });

    return { messages: nextMessages, savedMessageCount };
}

export async function saveSessionTurn(
    sessionId: string,
    userMessage: string,
    context: SessionTurnContext,
    result: ChatResponse,
) {
    const { messages, savedMessageCount } = context;
    const newMessages = messages.slice(savedMessageCount);

    await prisma.$transaction(async (tx) => {
        await tx.turn.create({
            data: {
                conversationId: sessionId,
                question: userMessage,
                answer: result.answer,
                error: result.error,
                stepsJson: JSON.stringify(result.steps),
                citationsJson: JSON.stringify(result.citations),
                tokenUsageJson: result.token_usage ? JSON.stringify(result.token_usage) : null,
            },
        });

        // Conversation 上的 message/answer 字段仅用于侧边栏展示最近一轮
        await tx.conversation.update({
            where: { id: sessionId },
            data: {
                message: userMessage,
                answer: result.answer,
                error: result.error,
                stepsJson: JSON.stringify(result.steps),
                citationsJson: JSON.stringify(result.citations),
            },
        });

        if (newMessages.length > 0) {
            await tx.message.createMany({
                data: newMessages.map((message, index) =>
                    toMessageData(sessionId, message, savedMessageCount + index),
                ),
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

export async function deleteConversation(sessionId: string) {
    // Message/Turn 都配置了 ON DELETE CASCADE，删主表即可
    const deleted = await prisma.conversation.deleteMany({
        where: { id: sessionId },
    });

    return deleted.count > 0;
}

export async function renameConversation(sessionId: string, title: string) {
    const updated = await prisma.conversation.update({
        where: { id: sessionId },
        data: { title },
    });

    return toHistoryItem(updated);
}

export async function getConversationDetail(sessionId: string): Promise<ConversationDetail | null> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: sessionId },
        include: {
            turns: {
                orderBy: {
                    createdAt: "asc",
                },
            },
        },
    });

    if (!conversation) {
        return null;
    }

    const withTurns = conversation as ConversationWithTurns;

    return {
        id: withTurns.id,
        title: withTurns.title,
        createdAt: withTurns.createdAt.toISOString(),
        updatedAt: withTurns.updatedAt.toISOString(),
        turns: withTurns.turns.map(toTurnHistoryItem),
    };
}
