import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { ChatTurn } from "../types/chat";
import { CitationsPanel } from "./CitationsPanel";
import { StepsPanel } from "./StepsPanel";

// Markdown 渲染链（react-markdown + highlight.js）体积大，按需加载
const MarkdownAnswer = lazy(() =>
    import("./MarkdownAnswer").then((module) => ({ default: module.MarkdownAnswer })),
);

type MessageThreadProps = {
    turns: ChatTurn[];
    selectedEvidencePath: string | null;
    onSelectEvidence: (filePath: string) => void;
};

const FOOTNOTE_FLASH_MS = 1800;

function formatTokenCount(value: number) {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function UsageBadge({ usage }: { usage: { prompt_tokens: number; completion_tokens: number } }) {
    return (
        <span className="assistant-usage">
            上下文 {formatTokenCount(usage.prompt_tokens)} · 生成 {formatTokenCount(usage.completion_tokens)} tokens
        </span>
    );
}

function TypingIndicator() {
    return (
        <div className="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-text">Agent 正在灯下翻阅代码...</span>
        </div>
    );
}

function TurnBlock({
    turn,
    selectedEvidencePath,
    onSelectEvidence,
}: {
    turn: ChatTurn;
    selectedEvidencePath: string | null;
    onSelectEvidence: (filePath: string) => void;
}) {
    // 被点击的脚注编号：滚动到对应出处条目并短暂高亮
    const [flashFootnote, setFlashFootnote] = useState<number | null>(null);
    const flashTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (flashTimerRef.current !== null) {
                window.clearTimeout(flashTimerRef.current);
            }
        };
    }, []);

    function handleCitationRef(index: number) {
        document.getElementById(`${turn.id}-fn-${index}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });

        setFlashFootnote(index);

        if (flashTimerRef.current !== null) {
            window.clearTimeout(flashTimerRef.current);
        }

        flashTimerRef.current = window.setTimeout(() => {
            setFlashFootnote(null);
            flashTimerRef.current = null;
        }, FOOTNOTE_FLASH_MS);
    }

    return (
        <article className="turn">
            <div className="turn-row-user">
                <div className="bubble-user">{turn.question}</div>
            </div>

            <div className="bubble-assistant">
                <div className="assistant-head">
                    <span className="assistant-avatar">AI</span>
                    <span className="assistant-name">Agent</span>
                    {turn.isStreaming ? (
                        <span className="assistant-status">
                            <span className="status-dot" />
                            翻阅中
                        </span>
                    ) : turn.error ? (
                        <span className="assistant-status assistant-status-error">{turn.error}</span>
                    ) : (
                        <span className="assistant-status">
                            已读完 · {turn.steps.length} 次工具调用 · {turn.citations.length} 处出处
                        </span>
                    )}
                    {turn.token_usage && !turn.isStreaming ? <UsageBadge usage={turn.token_usage} /> : null}
                </div>

                <div className="assistant-content">
                    {turn.answer ? (
                        <Suspense fallback={<div className="empty-state">排版载入中...</div>}>
                            <MarkdownAnswer content={turn.answer} onCitationRef={handleCitationRef} />
                        </Suspense>
                    ) : turn.isStreaming ? (
                        <TypingIndicator />
                    ) : (
                        <div className="empty-state">这一轮没有生成回答。</div>
                    )}
                </div>

                <StepsPanel
                    steps={turn.steps}
                    isStreaming={Boolean(turn.isStreaming)}
                    selectedEvidencePath={selectedEvidencePath}
                />

                <CitationsPanel
                    citations={turn.citations}
                    isStreaming={Boolean(turn.isStreaming)}
                    selectedFilePath={selectedEvidencePath}
                    onSelectFilePath={onSelectEvidence}
                    footnoteBaseId={turn.id}
                    flashFootnote={flashFootnote}
                />
            </div>
        </article>
    );
}

export function MessageThread({ turns, selectedEvidencePath, onSelectEvidence }: MessageThreadProps) {
    return (
        <div className="thread">
            {turns.map((turn) => (
                <TurnBlock
                    key={turn.id}
                    turn={turn}
                    selectedEvidencePath={selectedEvidencePath}
                    onSelectEvidence={onSelectEvidence}
                />
            ))}
        </div>
    );
}
