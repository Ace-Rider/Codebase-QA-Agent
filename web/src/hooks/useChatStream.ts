import { useEffect, useState } from "react";
import { fetchConversation, fetchConversationHistory, requestChatStream } from "../services/chat";
import type { ChatResponse, Citation, ConversationHistoryItem, Step } from "../types/chat";

const INITIAL_STATUS = "准备提问";
const MAX_HISTORY_ITEMS = 12;

function createHistoryId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `history-${Date.now()}`;
}

function buildHistoryTitle(message: string) {
    const trimmed = message.trim().replace(/\s+/g, " ");

    if (!trimmed) {
        return "未命名会话";
    }

    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
}

function createDraftHistoryItem(message: string): ConversationHistoryItem {
    const now = new Date().toISOString();

    return {
        id: createHistoryId(),
        title: buildHistoryTitle(message),
        message,
        answer: "",
        steps: [],
        citations: [],
        error: null,
        createdAt: now,
        updatedAt: now,
        isPending: true,
    };
}

function createFinalHistoryItem(
    draftItem: ConversationHistoryItem,
    result: ChatResponse,
): ConversationHistoryItem {
    return {
        ...draftItem,
        answer: result.answer,
        steps: result.steps,
        citations: result.citations,
        error: result.error,
        updatedAt: new Date().toISOString(),
        isPending: false,
    };
}

function upsertHistoryItem(currentItems: ConversationHistoryItem[], nextItem: ConversationHistoryItem) {
    const mergedItems = [nextItem, ...currentItems.filter((item) => item.id !== nextItem.id)];
    return mergedItems.slice(0, MAX_HISTORY_ITEMS);
}

export function useChatStream() {
    const [answer, setAnswer] = useState("");
    const [citations, setCitations] = useState<Citation[]>([]);
    const [steps, setSteps] = useState<Step[]>([]);
    const [status, setStatus] = useState(INITIAL_STATUS);
    const [isLoading, setIsLoading] = useState(false);
    const [historyItems, setHistoryItems] = useState<ConversationHistoryItem[]>([]);
    const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadInitialHistory() {
            try {
                const items = await fetchConversationHistory();

                if (!cancelled) {
                    setHistoryItems(items);
                }
            } catch (error) {
                if (!cancelled) {
                    setStatus(error instanceof Error ? error.message : "加载历史会话失败");
                }
            }
        }

        void loadInitialHistory();

        return () => {
            cancelled = true;
        };
    }, []);

    function upsertLocalHistory(item: ConversationHistoryItem) {
        setHistoryItems((currentItems) => upsertHistoryItem(currentItems, item));
    }

    function insertDraftHistory(message: string) {
        const activeItem = activeHistoryId
            ? historyItems.find((item) => item.id === activeHistoryId) ?? null
            : null;

        const draftItem = activeItem
            ? {
                ...activeItem,
                message,
                answer: "",
                steps: [],
                citations: [],
                error: null,
                updatedAt: new Date().toISOString(),
                isPending: true,
            }
            : createDraftHistoryItem(message);

        upsertLocalHistory(draftItem);
        setActiveHistoryId(draftItem.id);
        return draftItem;
    }

    function updateDraftHistory(itemId: string, patch: Partial<ConversationHistoryItem>) {
        setHistoryItems((currentItems) =>
            currentItems.map((item) =>
                item.id === itemId
                    ? {
                        ...item,
                        ...patch,
                        updatedAt: new Date().toISOString(),
                    }
                    : item,
            ),
        );
    }

    async function finalizeHistory(draftItem: ConversationHistoryItem, result: ChatResponse) {
        const nextItem = createFinalHistoryItem(draftItem, result);
        upsertLocalHistory(nextItem);
        setActiveHistoryId(nextItem.id);

        try {
            const savedItem = await fetchConversation(draftItem.id);
            upsertLocalHistory(savedItem);
            setAnswer(savedItem.answer);
            setCitations(savedItem.citations);
            setSteps(savedItem.steps);
            setStatus(savedItem.error ?? "已完成");
        } catch {
            setStatus(result.error ?? "已完成");
        }
    }

    async function restoreHistory(item: ConversationHistoryItem) {
        try {
            const savedItem = await fetchConversation(item.id);
            upsertLocalHistory(savedItem);
            setAnswer(savedItem.answer);
            setCitations(savedItem.citations);
            setSteps(savedItem.steps);
            setStatus(savedItem.error ? "该历史会话包含错误结果" : "正在查看历史会话");
            setActiveHistoryId(savedItem.id);
        } catch {
            setAnswer(item.answer);
            setCitations(item.citations);
            setSteps(item.steps);
            setStatus(item.error ? "该历史会话包含错误结果" : "正在查看历史会话");
            setActiveHistoryId(item.id);
        }
    }

    function startNewSession() {
        setAnswer("");
        setCitations([]);
        setSteps([]);
        setStatus(INITIAL_STATUS);
        setActiveHistoryId(null);
    }

    async function sendMessage(message: string) {
        const trimmed = message.trim();

        if (!trimmed || isLoading) {
            return;
        }

        const draftItem = insertDraftHistory(trimmed);

        setIsLoading(true);
        setAnswer("");
        setCitations([]);
        setSteps([]);
        setStatus("正在请求模型...");

        let liveAnswerBuffer = "";
        const liveSteps: Step[] = [];
        let finalResult: ChatResponse | null = null;
        let streamError: string | null = null;

        try {
            await requestChatStream(trimmed, draftItem.id, (event) => {
                switch (event.type) {
                    case "status":
                        setStatus(event.message);
                        break;
                    case "answer_delta":
                        liveAnswerBuffer += event.delta || "";
                        setAnswer(liveAnswerBuffer);
                        updateDraftHistory(draftItem.id, { answer: liveAnswerBuffer });
                        break;
                    case "answer_reset":
                        liveAnswerBuffer = "";
                        setAnswer("");
                        updateDraftHistory(draftItem.id, { answer: "" });
                        break;
                    case "step":
                        liveSteps.push(event.step);
                        setSteps([...liveSteps]);
                        updateDraftHistory(draftItem.id, { steps: [...liveSteps] });
                        break;
                    case "error":
                        streamError = event.error || "request failed";
                        setStatus(streamError);
                        updateDraftHistory(draftItem.id, { error: streamError });
                        break;
                    case "final":
                        finalResult = event.result;
                        liveAnswerBuffer = event.result.answer || "";
                        setAnswer(liveAnswerBuffer);
                        setCitations(event.result.citations || []);
                        setSteps(event.result.steps || liveSteps);
                        setStatus(event.result.error || "已完成");
                        break;
                }
            });

            const snapshot =
                finalResult ??
                ({
                    answer: liveAnswerBuffer,
                    steps: liveSteps,
                    citations: [],
                    error: streamError,
                } satisfies ChatResponse);

            await finalizeHistory(draftItem, snapshot);
        } catch (caughtError) {
            const messageText = caughtError instanceof Error ? caughtError.message : "unknown error";
            const errorResult: ChatResponse = {
                answer: liveAnswerBuffer,
                citations: [],
                steps: liveSteps,
                error: messageText,
            };

            setAnswer(liveAnswerBuffer);
            setCitations([]);
            setSteps(liveSteps);
            setStatus(messageText);
            await finalizeHistory(draftItem, errorResult);
        } finally {
            setIsLoading(false);
        }
    }

    return {
        answer,
        citations,
        steps,
        status,
        isLoading,
        historyItems,
        activeHistoryId,
        restoreHistory,
        startNewSession,
        sendMessage,
    };
}
