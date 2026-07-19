import type { KeyboardEvent } from "react";
import type { ConversationHistoryItem } from "../types/chat";

type ChatInputProps = {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    disabled: boolean;
    status: string;
    activeSession: ConversationHistoryItem | null;
};

const EXAMPLES = [
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

function buildSessionStatus(activeSession: ConversationHistoryItem | null) {
    if (!activeSession) {
        return {
            label: "新会话",
            title: "下一次发送将开启全新会话",
            description: "如果你想延续上下文，先去最近会话里选中一条历史会话。",
        };
    }

    if (activeSession.isPending) {
        return {
            label: "当前会话",
            title: activeSession.title,
            description: "这次提问会继续当前会话，并把新的分析结果接在这条会话后面。",
        };
    }

    return {
        label: "继续追问",
        title: activeSession.title,
        description: "你现在发送的新问题，会沿用这条会话之前的上下文继续分析。",
    };
}

export function ChatInput({ value, onChange, onSend, disabled, status, activeSession }: ChatInputProps) {
    const sessionStatus = buildSessionStatus(activeSession);

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key !== "Enter" || event.shiftKey) {
            return;
        }

        event.preventDefault();

        if (!disabled && value.trim()) {
            onSend();
        }
    }

    return (
        <section className="panel sidebar-panel">
            <div className="sidebar-card current-session-card">
                <div className="current-session-top">
                    <span className="panel-kicker panel-kicker-quiet">{sessionStatus.label}</span>
                </div>
                <strong className="current-session-title">{sessionStatus.title}</strong>
                <p className="current-session-description">{sessionStatus.description}</p>
            </div>

            <div className="sidebar-card">
                <div className="input-label">Prompt</div>
                <textarea
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="例如：读取 src/agent/run-agent.ts，并解释为什么要多轮 loop 才能完成工具调用"
                />
            </div>

            <button className="submit-btn" type="button" onClick={onSend} disabled={disabled}>
                {disabled ? "正在分析..." : "开始分析"}
            </button>

            <div className="sidebar-card">
                <div className="input-label">Quick Tasks</div>
                <div className="quick-list">
                    {EXAMPLES.map((example) => (
                        <button
                            key={example.title}
                            className="quick-item"
                            type="button"
                            onClick={() => onChange(example.prompt)}
                        >
                            <strong>{example.title}</strong>
                            <span>{example.description}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="status-strip">
                <span className="status-dot" />
                <span>{status}</span>
            </div>
        </section>
    );
}
