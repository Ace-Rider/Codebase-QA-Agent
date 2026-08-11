import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ConversationHistoryItem } from "../types/chat";

type HistorySidebarProps = {
    items: ConversationHistoryItem[];
    activeHistoryId: string | null;
    disabled: boolean;
    isOpen: boolean;
    onSelectHistory: (item: ConversationHistoryItem) => void;
    onClose: () => void;
    onDeleteHistory: (sessionId: string) => void;
    onRenameHistory: (sessionId: string, title: string) => void;
};

function formatHistoryTime(isoString: string) {
    const date = new Date(isoString);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function buildHistoryMeta(item: ConversationHistoryItem) {
    if (item.isPending) {
        return "当前会话生成中";
    }

    if (item.error) {
        return "本次请求出现错误";
    }

    return `${item.steps.length} 个步骤 · ${item.citations.length} 条证据`;
}

function buildHistoryPreview(item: ConversationHistoryItem) {
    const compactMessage = item.message.trim().replace(/\s+/g, " ");

    if (!compactMessage) {
        return "这条会话还没有可展示的提问内容。";
    }

    return compactMessage;
}

function RenameInput({
    initialTitle,
    onCommit,
    onCancel,
}: {
    initialTitle: string;
    onCommit: (title: string) => void;
    onCancel: () => void;
}) {
    const [title, setTitle] = useState(initialTitle);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        event.stopPropagation();

        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
        }
    }

    function commit() {
        const trimmed = title.trim();
        if (trimmed && trimmed !== initialTitle) onCommit(trimmed);
        else onCancel();
    }

    return (
        <input
            ref={inputRef}
            className="history-rename-input"
            value={title}
            maxLength={60}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            onClick={(event) => event.stopPropagation()}
        />
    );
}

export function HistorySidebar({
    items,
    activeHistoryId,
    disabled,
    isOpen,
    onSelectHistory,
    onClose,
    onDeleteHistory,
    onRenameHistory,
}: HistorySidebarProps) {
    const [renamingId, setRenamingId] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setRenamingId(null);
        }
    }, [isOpen]);

    function handleDelete(item: ConversationHistoryItem) {
        if (window.confirm(`删除会话「${item.title}」？该操作不可恢复。`)) {
            onDeleteHistory(item.id);
        }
    }

    return (
        <>
            <div
                className={["history-drawer-backdrop", isOpen ? "history-drawer-backdrop-open" : ""]
                    .filter(Boolean)
                    .join(" ")}
                onClick={onClose}
            />

            <aside
                className={["history-drawer", isOpen ? "history-drawer-open" : ""].filter(Boolean).join(" ")}
                aria-hidden={!isOpen}
            >
                <div className="history-drawer-head">
                    <div>
                        <div className="panel-kicker panel-kicker-quiet">History</div>
                        <h2>最近会话</h2>
                    </div>

                    <div className="history-drawer-actions">
                        <span className="panel-counter">{items.length} 条</span>
                        <button className="history-close-btn" type="button" onClick={onClose}>
                            关闭
                        </button>
                    </div>
                </div>

                {items.length === 0 ? (
                    <div className="history-empty history-empty-drawer">
                        <div className="history-empty-copy">还没有历史会话，先发起一次分析吧。</div>
                    </div>
                ) : (
                    <div className="history-drawer-list">
                        {items.map((item) => {
                            const isActive = item.id === activeHistoryId;
                            const isRenaming = item.id === renamingId;

                            return (
                                <div
                                    key={item.id}
                                    className={[
                                        "history-item",
                                        isActive ? "history-item-active" : "",
                                        item.isPending ? "history-item-pending" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    role="button"
                                    tabIndex={disabled ? -1 : 0}
                                    aria-disabled={disabled}
                                    onClick={() => {
                                        if (!disabled && !isRenaming) {
                                            onSelectHistory(item);
                                        }
                                    }}
                                    onKeyDown={(event) => {
                                        if (disabled || isRenaming) {
                                            return;
                                        }

                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            onSelectHistory(item);
                                        }
                                    }}
                                >
                                    <div className="history-item-top">
                                        {isRenaming ? (
                                            <RenameInput
                                                initialTitle={item.title}
                                                onCommit={(title) => {
                                                    setRenamingId(null);
                                                    onRenameHistory(item.id, title);
                                                }}
                                                onCancel={() => setRenamingId(null)}
                                            />
                                        ) : (
                                            <strong>{item.title}</strong>
                                        )}
                                        <span className="history-item-time">{formatHistoryTime(item.updatedAt)}</span>
                                    </div>
                                    <div className="history-item-preview">{buildHistoryPreview(item)}</div>
                                    <div className="history-item-footer">
                                        <div className="history-item-meta">{buildHistoryMeta(item)}</div>

                                        <div className="history-item-ops">
                                            {isActive && !item.isPending ? (
                                                <span className="history-item-badge">
                                                    {item.isPending ? "当前会话" : "已选中"}
                                                </span>
                                            ) : null}
                                            <span
                                                className="history-op-btn"
                                                role="button"
                                                tabIndex={disabled ? -1 : 0}
                                                title="重命名"
                                                aria-label={`重命名会话 ${item.title}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setRenamingId(item.id);
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.stopPropagation();
                                                        setRenamingId(item.id);
                                                    }
                                                }}
                                            >
                                                ✎
                                            </span>
                                            <span
                                                className="history-op-btn history-op-danger"
                                                role="button"
                                                tabIndex={disabled ? -1 : 0}
                                                title="删除"
                                                aria-label={`删除会话 ${item.title}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleDelete(item);
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.stopPropagation();
                                                        handleDelete(item);
                                                    }
                                                }}
                                            >
                                                ✕
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </aside>
        </>
    );
}
