import { useEffect, useRef, useState } from "react";
import { AnswerPanel } from "./components/AnswerPanel";
import { ChatInput } from "./components/ChatInput";
import { CitationsPanel } from "./components/CitationsPanel";
import { HistorySidebar } from "./components/HistorySidebar";
import { StepsPanel } from "./components/StepsPanel";
import { useChatStream } from "./hooks/useChatStream";
import type { ConversationHistoryItem } from "./types/chat";

const AUTO_FOLLOW_BOTTOM_OFFSET = 140;

export default function App() {
    const [message, setMessage] = useState("");
    const [showBackToTop, setShowBackToTop] = useState(false);
    const [selectedEvidencePath, setSelectedEvidencePath] = useState<string | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const shouldAutoFollowRef = useRef(true);
    const {
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
    } = useChatStream();

    const activeSession =
        activeHistoryId !== null ? historyItems.find((item) => item.id === activeHistoryId) ?? null : null;

    function isNearPageBottom() {
        return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - AUTO_FOLLOW_BOTTOM_OFFSET;
    }

    function scrollToPageBottom() {
        window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth",
        });
    }

    useEffect(() => {
        const handleScroll = () => {
            setShowBackToTop(window.scrollY > 280);
            shouldAutoFollowRef.current = isNearPageBottom();
        };

        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            window.removeEventListener("scroll", handleScroll);
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

        const stillExists = citations.some((citation) => citation.file_path === selectedEvidencePath);
        if (!stillExists) {
            setSelectedEvidencePath(null);
        }
    }, [citations, selectedEvidencePath]);

    useEffect(() => {
        if (!isLoading) {
            return;
        }

        let frameId = 0;

        const followIfNeeded = () => {
            if (!shouldAutoFollowRef.current) {
                return;
            }

            cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                scrollToPageBottom();
            });
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

        resizeObserver.observe(document.body);

        return () => {
            cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
        };
    }, [isLoading]);

    async function handleSend() {
        setSelectedEvidencePath(null);
        await sendMessage(message);
    }

    function handleBackToTop() {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function handleSelectEvidence(filePath: string) {
        setSelectedEvidencePath((current) => (current === filePath ? null : filePath));
    }

    async function handleSelectHistory(item: ConversationHistoryItem) {
        setSelectedEvidencePath(null);
        setMessage(item.message);
        await restoreHistory(item);
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (window.innerWidth <= 980) {
            setHistoryOpen(false);
        }
    }

    function handleStartNewSession() {
        setSelectedEvidencePath(null);
        setMessage("");
        startNewSession();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    return (
        <div className="page-shell">
            <header className="hero">
                <div className="hero-top">
                    <div className="hero-badge">Codebase Agent</div>
                    <div className="hero-actions">
                        <button className="new-session-btn" type="button" onClick={handleStartNewSession}>
                            新建会话
                        </button>
                        <button className="history-toggle-btn" type="button" onClick={() => setHistoryOpen(true)}>
                            最近会话
                            <span className="history-toggle-count">{historyItems.length}</span>
                        </button>
                    </div>
                </div>
                <h1>代码库 Agent 控制台</h1>
                <p className="hero-subtitle">
                    用更工程化的方式查看回答、证据和工具执行轨迹，让 Agent 的分析过程真正可见。
                </p>
            </header>

            <main className="layout">
                <ChatInput
                    value={message}
                    onChange={setMessage}
                    onSend={handleSend}
                    disabled={isLoading}
                    status={status}
                    activeSession={activeSession}
                />

                <section className="stack">
                    <AnswerPanel answer={answer} isLoading={isLoading} />
                    <CitationsPanel
                        citations={citations}
                        isLoading={isLoading}
                        selectedFilePath={selectedEvidencePath}
                        onSelectFilePath={handleSelectEvidence}
                    />
                    <StepsPanel
                        steps={steps}
                        isLoading={isLoading}
                        selectedEvidencePath={selectedEvidencePath}
                    />
                </section>
            </main>

            <HistorySidebar
                items={historyItems}
                activeHistoryId={activeHistoryId}
                disabled={isLoading}
                isOpen={historyOpen}
                onSelectHistory={(item) => {
                    void handleSelectHistory(item);
                }}
                onClose={() => setHistoryOpen(false)}
            />

            {showBackToTop ? (
                <button className="back-to-top-btn" type="button" onClick={handleBackToTop}>
                    回到顶部
                </button>
            ) : null}
        </div>
    );
}
