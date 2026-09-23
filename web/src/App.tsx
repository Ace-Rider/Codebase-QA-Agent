import { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput, EXAMPLE_SUGGESTIONS } from "./components/ChatInput";
import { HistorySidebar } from "./components/HistorySidebar";
import { MessageThread } from "./components/MessageThread";
import { useChatStream } from "./hooks/useChatStream";
import type { ConversationHistoryItem } from "./types/chat";

const AUTO_FOLLOW_BOTTOM_OFFSET = 140;
// 未选中任何历史会话时，输入草稿挂在虚拟 key "__new__" 上
const DRAFT_NEW_SESSION_KEY = "__new__";

export default function App() {
    const [message, setMessage] = useState("");
    const [selectedEvidencePath, setSelectedEvidencePath] = useState<string | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [isNearBottom, setIsNearBottom] = useState(true);
    const scrollRef = useRef<HTMLElement | null>(null);
    const shouldAutoFollowRef = useRef(true);
    // 每个会话一份输入草稿：切走再回来，打了一半的问题不丢
    const draftsRef = useRef<Map<string, string>>(new Map());
    const {
        turns,
        status,
        isLoading,
        historyItems,
        activeHistoryId,
        workspace,
        restoreHistory,
        startNewSession,
        sendMessage,
        stopGeneration,
        deleteHistoryItem,
        renameHistoryItem,
    } = useChatStream();

    const activeSession =
        activeHistoryId !== null ? historyItems.find((item) => item.id === activeHistoryId) ?? null : null;

    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    const lampState = isLoading ? "lamp-working" : lastTurn?.error ? "lamp-error" : "";
    // 灯是纯视觉元素（aria-hidden），这里用 live region 把状态变化播报给屏幕阅读器
    const lampAnnouncement = isLoading
        ? "Agent 正在工作"
        : lastTurn?.error
          ? "回答出错，灯已变红"
          : "";

    const allCitations = useMemo(() => turns.flatMap((turn) => turn.citations), [turns]);

    function isNearThreadBottom() {
        const element = scrollRef.current;

        if (!element) {
            return true;
        }

        return element.scrollHeight - element.scrollTop - element.clientHeight < AUTO_FOLLOW_BOTTOM_OFFSET;
    }

    function scrollToThreadBottom() {
        const element = scrollRef.current;

        if (element) {
            element.scrollTo({ top: element.scrollHeight });
        }
    }

    useEffect(() => {
        const element = scrollRef.current;

        if (!element) {
            return;
        }

        const handleScroll = () => {
            const near = isNearThreadBottom();
            setIsNearBottom(near);
            shouldAutoFollowRef.current = near;
        };

        element.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            element.removeEventListener("scroll", handleScroll);
        };
    }, []);

    useEffect(() => {
        if (!historyOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setHistoryOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [historyOpen]);

    useEffect(() => {
        if (!selectedEvidencePath) {
            return;
        }

        const stillExists = allCitations.some((citation) => citation.file_path === selectedEvidencePath);

        if (!stillExists) {
            setSelectedEvidencePath(null);
        }
    }, [allCitations, selectedEvidencePath]);

    useEffect(() => {
        const element = scrollRef.current;

        if (!element || !isLoading) {
            return;
        }

        let frameId = 0;

        const followIfNeeded = () => {
            if (!shouldAutoFollowRef.current) {
                return;
            }

            cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(scrollToThreadBottom);
        };

        followIfNeeded();

        if (typeof ResizeObserver === "undefined") {
            return () => {
                cancelAnimationFrame(frameId);
            };
        }

        const resizeObserver = new ResizeObserver(() => {
            followIfNeeded();
        });

        resizeObserver.observe(element);

        return () => {
            cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
        };
    }, [isLoading, turns]);

    function currentDraftKey() {
        return activeHistoryId ?? DRAFT_NEW_SESSION_KEY;
    }

    function switchDraftTo(nextKey: string) {
        draftsRef.current.set(currentDraftKey(), message);
        setMessage(draftsRef.current.get(nextKey) ?? "");
    }

    async function handleSend() {
        setSelectedEvidencePath(null);
        // sendMessage 过程中 activeHistoryId 会切换到新会话，先记住草稿所属 key
        const draftKey = currentDraftKey();
        await sendMessage(message);
        draftsRef.current.delete(draftKey);
        setMessage("");
        shouldAutoFollowRef.current = true;
        window.requestAnimationFrame(scrollToThreadBottom);
    }

    // 失败轮次的重试：直接复用该轮的问题重新发送
    async function handleRetryTurn(question: string) {
        if (isLoading) {
            return;
        }

        setSelectedEvidencePath(null);
        shouldAutoFollowRef.current = true;
        window.requestAnimationFrame(scrollToThreadBottom);
        await sendMessage(question);
    }

    function handleSelectEvidence(filePath: string) {
        setSelectedEvidencePath((current) => (current === filePath ? null : filePath));
    }

    async function handleSelectHistory(item: ConversationHistoryItem) {
        setSelectedEvidencePath(null);
        switchDraftTo(item.id);
        await restoreHistory(item);
        window.requestAnimationFrame(scrollToThreadBottom);

        if (window.innerWidth <= 980) {
            setHistoryOpen(false);
        }
    }

    function handleStartNewSession() {
        setSelectedEvidencePath(null);
        switchDraftTo(DRAFT_NEW_SESSION_KEY);
        startNewSession();
    }

    return (
        <div className="app-shell">
            <span aria-live="polite" className="sr-only">
                {lampAnnouncement}
            </span>
            <header className="top-bar">
                <span className={["lamp", lampState].filter(Boolean).join(" ")} aria-hidden="true" />
                <div className="top-brand">
                    <span className="brand-name">夜读</span>
                    <span className="brand-sub">
                        {workspace ? `正在读 · ${workspace.name}` : "Codebase Agent · 答案有出处"}
                    </span>
                </div>
                <div className="top-actions">
                    <button className="ghost-btn" type="button" onClick={handleStartNewSession}>
                        新建会话
                    </button>
                    <button className="ghost-btn" type="button" onClick={() => setHistoryOpen(true)}>
                        最近会话
                        <span className="history-toggle-count">{historyItems.length}</span>
                    </button>
                </div>
            </header>

            <main className="thread-scroll" ref={scrollRef}>
                {turns.length === 0 ? (
                    <div className="welcome">
                        <h1>今晚，从哪一段代码读起？</h1>
                        <p className="welcome-subtitle">
                            Agent 会自己去读文件、执行检索，把每一步与每一处出处都摆在灯下——回答不是没有根据的一句话。
                        </p>
                        <div className="suggestion-grid">
                            {EXAMPLE_SUGGESTIONS.map((example) => (
                                <button
                                    key={example.title}
                                    className="quick-item"
                                    type="button"
                                    onClick={() => setMessage(example.prompt)}
                                >
                                    <strong>{example.title}</strong>
                                    <span>{example.description}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <MessageThread
                        turns={turns}
                        selectedEvidencePath={selectedEvidencePath}
                        onSelectEvidence={handleSelectEvidence}
                        onRetryTurn={(question) => {
                            void handleRetryTurn(question);
                        }}
                    />
                )}
            </main>

            <footer className="composer-bar">
                <ChatInput
                    value={message}
                    onChange={setMessage}
                    onSend={() => {
                        void handleSend();
                    }}
                    onStop={stopGeneration}
                    isLoading={isLoading}
                    status={status}
                    activeSession={activeSession}
                />
            </footer>

            {!isNearBottom ? (
                <button className="jump-latest-btn" type="button" onClick={scrollToThreadBottom}>
                    回到最新 ↓
                </button>
            ) : null}

            <HistorySidebar
                items={historyItems}
                activeHistoryId={activeHistoryId}
                disabled={isLoading}
                isOpen={historyOpen}
                onSelectHistory={(item) => {
                    void handleSelectHistory(item);
                }}
                onClose={() => setHistoryOpen(false)}
                onDeleteHistory={(sessionId) => {
                    void deleteHistoryItem(sessionId);
                }}
                onRenameHistory={(sessionId, title) => {
                    void renameHistoryItem(sessionId, title);
                }}
            />
        </div>
    );
}
