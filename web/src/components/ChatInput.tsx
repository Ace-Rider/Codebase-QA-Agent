import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ConversationHistoryItem } from "../types/chat";

type ChatInputProps = {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    onStop: () => void;
    isLoading: boolean;
    status: string;
    activeSession: ConversationHistoryItem | null;
};

export const EXAMPLE_SUGGESTIONS = [
    {
        title: "理解项目结构",
        description: "列出 src 目录下的关键文件，并总结模块分层。",
        prompt: "列出 src 目录下的关键文件，并总结模块分层。",
    },
    {
        title: "解释 Agent Loop",
        description: "读取 src/agent/run-agent.ts，并解释为什么需要多轮 loop。",
        prompt: "读取 src/agent/run-agent.ts，并解释为什么需要多轮 loop。",
    },
    {
        title: "分析流式链路",
        description: "同时读取 src/index.ts、src/lib/model.ts 和 src/agent/run-agent.ts，并解释流式链路。",
        prompt: "同时读取 src/index.ts、src/lib/model.ts 和 src/agent/run-agent.ts，并解释流式链路。",
    },
];

function buildSessionHint(activeSession: ConversationHistoryItem | null) {
    if (!activeSession) {
        return "新会话";
    }

    if (activeSession.isPending) {
        return "当前会话";
    }

    return "继续追问";
}

export function ChatInput({ value, onChange, onSend, onStop, isLoading, status, activeSession }: ChatInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const element = textareaRef.current;

        if (!element) {
            return;
        }

        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
    }, [value]);

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key !== "Enter" || event.shiftKey) {
            return;
        }

        event.preventDefault();

        if (!isLoading && value.trim()) {
            onSend();
        }
    }

    return (
        <section className="composer">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="接着问，灯还亮着"
                rows={1}
            />

            <div className="composer-foot">
                <div className="composer-status">
                    <span className="status-dot" />
                    <span className="composer-status-text">{status}</span>
                    <span className="composer-session-chip">{buildSessionHint(activeSession)}</span>
                </div>

                <div className="composer-actions">
                    {isLoading ? (
                        <button className="stop-btn" type="button" onClick={onStop}>
                            停止生成
                        </button>
                    ) : (
                        <button
                            className="submit-btn"
                            type="button"
                            onClick={onSend}
                            disabled={!value.trim()}
                        >
                            发送
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}
