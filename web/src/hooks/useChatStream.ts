import { useEffect, useRef, useState } from "react";
import {
    deleteConversationRequest,
    fetchConversationDetail,
    fetchConversationHistory,
    renameConversationRequest,
    requestChatStream,
} from "../services/chat";
import type { ChatResponse, ChatTurn, ConversationHistoryItem, Step } from "../types/chat";

const INITIAL_STATUS = "准备提问";
const MAX_HISTORY_ITEMS = 12;
const STOPPED_MESSAGE = "已手动停止生成";

function createId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
        id: createId(),
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

function upsertHistoryItem(currentItems: ConversationHistoryItem[], nextItem: ConversationHistoryItem) {
    const mergedItems = [nextItem, ...currentItems.filter((item) => item.id !== nextItem.id)];
    return mergedItems.slice(0, MAX_HISTORY_ITEMS);
}

export function useChatStream() {
    const [turns, setTurns] = useState<ChatTurn[]>([]);
    const [status, setStatus] = useState(INITIAL_STATUS);
    const [isLoading, setIsLoading] = useState(false);
    const [historyItems, setHistoryItems] = useState<ConversationHistoryItem[]>([]);
    const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);

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

    function patchTurn(turnId: string, patch: Partial<ChatTurn>) {
        setTurns((currentTurns) =>
            currentTurns.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn)),
        );
    }

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
                updatedAt: new Date().toISOString(),
                isPending: true,
            }
            : createDraftHistoryItem(message);

        upsertLocalHistory(draftItem);
        setActiveHistoryId(draftItem.id);
        return draftItem;
    }

    async function finalizeFromServer(draftItem: ConversationHistoryItem) {
        try {
            const detail = await fetchConversationDetail(draftItem.id);

            setTurns(detail.turns);
            setActiveHistoryId(detail.id);
            upsertLocalHistory({
                id: detail.id,
                title: detail.title,
                message: draftItem.message,
                answer: draftItem.answer,
                steps: draftItem.steps,
                citations: draftItem.citations,
                error: draftItem.error,
                createdAt: detail.createdAt,
                updatedAt: detail.updatedAt,
                isPending: false,
            });
        } catch {
            // 拿不到服务端详情时保留本地流式结果即可
        }
    }

    async function restoreHistory(item: ConversationHistoryItem) {
        try {
            const detail = await fetchConversationDetail(item.id);

            setTurns(detail.turns);
            setActiveHistoryId(detail.id);
            upsertLocalHistory({
                ...item,
                isPending: false,
                updatedAt: detail.updatedAt,
            });
            setStatus(item.error ? "该历史会话包含错误结果" : "正在查看历史会话");
        } catch {
            // 接口失败时退回本地缓存的单轮摘要
            setTurns([
                {
                    id: `${item.id}-local`,
                    question: item.message,
                    answer: item.answer,
                    steps: item.steps,
                    citations: item.citations,
                    error: item.error,
                    createdAt: item.updatedAt,
                },
            ]);
            setActiveHistoryId(item.id);
            setStatus(item.error ? "该历史会话包含错误结果" : "正在查看历史会话");
        }
    }

    function startNewSession() {
        setTurns([]);
        setStatus(INITIAL_STATUS);
        setActiveHistoryId(null);
    }

    function stopGeneration() {
        abortRef.current?.abort();
    }

    async function sendMessage(message: string) {
        const trimmed = message.trim();

        if (!trimmed || isLoading) {
            return;
        }

        const draftItem = insertDraftHistory(trimmed);
        const turnId = createId();

        setIsLoading(true);
        setStatus("正在请求模型...");

        setTurns((currentTurns) => [
            ...currentTurns,
            {
                id: turnId,
                question: trimmed,
                answer: "",
                steps: [],
                citations: [],
                error: null,
                isStreaming: true,
            },
        ]);

        const abortController = new AbortController();
        abortRef.current = abortController;

        // 流式增量先进入 pending 缓冲，用 rAF 每帧只提交一次，避免每个 delta 都触发重渲染
        const answerRef = { current: "" };
        const pendingRef = { current: "" };
        const stepsRef = { current: [] as Step[] };
        const frameRef = { current: 0 };

        const commitPending = () => {
            frameRef.current = 0;

            if (!pendingRef.current) {
                return;
            }

            answerRef.current += pendingRef.current;
            pendingRef.current = "";
            patchTurn(turnId, { answer: answerRef.current });
        };

        const scheduleDelta = (delta: string) => {
            pendingRef.current += delta;

            if (!frameRef.current) {
                frameRef.current = window.requestAnimationFrame(commitPending);
            }
        };

        const flushPending = () => {
            if (frameRef.current) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = 0;
            }
            commitPending();
        };

        let streamError: string | null = null;
        let finalResult: ChatResponse | null = null;

        try {
            await requestChatStream(
                trimmed,
                draftItem.id,
                (event) => {
                    switch (event.type) {
                        case "status":
                            setStatus(event.message);
                            break;
                        case "answer_delta":
                            scheduleDelta(event.delta || "");
                            break;
                        case "answer_reset":
                            flushPending();
                            answerRef.current = "";
                            patchTurn(turnId, { answer: "" });
                            break;
                        case "step":
                            stepsRef.current = [...stepsRef.current, event.step];
                            patchTurn(turnId, { steps: stepsRef.current });
                            break;
                        case "error":
                            streamError = event.error || "request failed";
                            setStatus(streamError);
                            break;
                        case "final":
                            finalResult = event.result;
                            flushPending();

                            if (event.result.answer) {
                                answerRef.current = event.result.answer;
                            }

                            stepsRef.current = event.result.steps?.length ? event.result.steps : stepsRef.current;
                            patchTurn(turnId, {
                                answer: answerRef.current,
                                steps: stepsRef.current,
                                citations: event.result.citations || [],
                                error: event.result.error,
                                token_usage: event.result.token_usage ?? null,
                                isStreaming: false,
                            });
                            setStatus(event.result.error || "已完成");
                            break;
                    }
                },
                abortController.signal,
            );

            flushPending();

            const snapshot: ChatResponse =
                finalResult ??
                {
                    answer: answerRef.current,
                    steps: stepsRef.current,
                    citations: [],
                    error: streamError,
                };

            patchTurn(turnId, {
                answer: snapshot.answer,
                steps: snapshot.steps,
                citations: snapshot.citations,
                error: snapshot.error,
                isStreaming: false,
            });

            upsertLocalHistory({
                ...draftItem,
                answer: snapshot.answer,
                steps: snapshot.steps,
                citations: snapshot.citations,
                error: snapshot.error,
                updatedAt: new Date().toISOString(),
                isPending: false,
            });
            setStatus(snapshot.error || "已完成");

            // final 事件在服务端落库之后才发出，此时回读可拿到规范的 turn 记录
            if (!snapshot.error) {
                await finalizeFromServer({
                    ...draftItem,
                    answer: snapshot.answer,
                    steps: snapshot.steps,
                    citations: snapshot.citations,
                    error: null,
                });
            }
        } catch (caughtError) {
            flushPending();
            const isAborted = abortController.signal.aborted;

            if (isAborted) {
                patchTurn(turnId, {
                    answer: answerRef.current || "（已停止生成）",
                    steps: stepsRef.current,
                    error: STOPPED_MESSAGE,
                    isStreaming: false,
                });
                setStatus(STOPPED_MESSAGE);
                upsertLocalHistory({
                    ...draftItem,
                    answer: answerRef.current,
                    steps: stepsRef.current,
                    error: STOPPED_MESSAGE,
                    updatedAt: new Date().toISOString(),
                    isPending: false,
                });
            } else {
                const messageText = caughtError instanceof Error ? caughtError.message : "unknown error";

                patchTurn(turnId, {
                    answer: answerRef.current,
                    steps: stepsRef.current,
                    citations: [],
                    error: messageText,
                    isStreaming: false,
                });
                setStatus(messageText);
                upsertLocalHistory({
                    ...draftItem,
                    answer: answerRef.current,
                    steps: stepsRef.current,
                    error: messageText,
                    updatedAt: new Date().toISOString(),
                    isPending: false,
                });
            }
        } finally {
            abortRef.current = null;
            setIsLoading(false);
        }
    }

    async function deleteHistoryItem(sessionId: string) {
        await deleteConversationRequest(sessionId);
        setHistoryItems((items) => items.filter((item) => item.id !== sessionId));

        // 删除的是当前打开的会话：回到空白新会话
        if (activeHistoryId === sessionId) {
            setActiveHistoryId(null);
            setTurns([]);
            setStatus(INITIAL_STATUS);
        }
    }

    async function renameHistoryItem(sessionId: string, title: string) {
        const updated = await renameConversationRequest(sessionId, title);
        setHistoryItems((items) =>
            items.map((item) => (item.id === sessionId ? { ...item, title: updated.title } : item)),
        );
    }

    return {
        turns,
        status,
        isLoading,
        historyItems,
        activeHistoryId,
        restoreHistory,
        startNewSession,
        sendMessage,
        stopGeneration,
        deleteHistoryItem,
        renameHistoryItem,
    };
}
