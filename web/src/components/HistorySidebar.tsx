import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { fetchConversationDetail } from "../services/chat";
import type { ChatTurn, ConversationHistoryItem } from "../types/chat";

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

function buildCitationLine(citation: ChatTurn["citations"][number]) {
    const location = citation.line_number ? ` L${citation.line_number}` : "";
    return `- \`${citation.file_path}\`${location}`;
}

function buildConversationMarkdown(title: string, turns: ChatTurn[]) {
    const exportedAt = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "long",
        timeStyle: "short",
    }).format(new Date());

    const sections = turns.map((turn, index) => {
        const lines: string[] = [`## 问 ${index + 1}：${turn.question}`, ""];

        if (turn.error) {
            lines.push(`> ⚠️ 此轮出现错误：${turn.error}`, "");
        }

        if (turn.answer) {
            lines.push(turn.answer, "");
        }

        if (turn.steps.length > 0) {
            const stepLines = turn.steps.map(
                (step) =>
                    `- 第 ${step.iteration} 轮 · ${step.tool_label || step.tool_name}${
                        step.status === "error" ? "（失败）" : ""
                    }`,
            );
            lines.push("**工具轨迹**", "", ...stepLines, "");
        }

        if (turn.citations.length > 0) {
            lines.push("**依据出处**", "", ...turn.citations.map(buildCitationLine), "");
        }

        return lines.join("\n");
    });

    return [
        `# ${title}`,
        "",
        `> 由 Codebase QA Agent · 夜读 导出于 ${exportedAt}`,
        "",
        sections.join("\n---\n\n"),
        "",
    ].join("\n");
}

function sanitizeFilename(name: string) {
    return name.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 50) || "conversation";
}

function downloadMarkdown(title: string, content: string) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFilename(title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
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
    const [searchText, setSearchText] = useState("");
    const [exportingId, setExportingId] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setRenamingId(null);
        }
    }, [isOpen]);

    const normalizedQuery = searchText.trim().toLowerCase();
    const visibleItems = normalizedQuery
        ? items.filter(
              (item) =>
                  item.title.toLowerCase().includes(normalizedQuery) ||
                  item.message.toLowerCase().includes(normalizedQuery),
          )
        : items;

    function handleDelete(item: ConversationHistoryItem) {
        if (window.confirm(`删除会话「${item.title}」？该操作不可恢复。`)) {
            onDeleteHistory(item.id);
        }
    }

    async function handleExport(item: ConversationHistoryItem) {
        if (exportingId || item.isPending) {
            return;
        }

        setExportingId(item.id);

        try {
            const detail = await fetchConversationDetail(item.id);
            downloadMarkdown(detail.title, buildConversationMarkdown(detail.title, detail.turns));
        } catch {
            window.alert("导出失败，请稍后重试。");
        } finally {
            setExportingId(null);
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
                        <span className="panel-counter">
                            {normalizedQuery ? `${visibleItems.length}/${items.length} 条` : `${items.length} 条`}
                        </span>
                        <button className="history-close-btn" type="button" onClick={onClose}>
                            关闭
                        </button>
                    </div>
                </div>

                <div className="history-search">
                    <input
                        type="search"
                        value={searchText}
                        placeholder="搜索标题或提问内容…"
                        aria-label="搜索历史会话"
                        onChange={(event) => setSearchText(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                    />
                    {searchText ? (
                        <button
                            className="history-search-clear"
                            type="button"
                            aria-label="清空搜索"
                            onClick={() => setSearchText("")}
                        >
                            ✕
                        </button>
                    ) : null}
                </div>

                {items.length === 0 ? (
                    <div className="history-empty history-empty-drawer">
                        <div className="history-empty-copy">还没有历史会话，先发起一次分析吧。</div>
                    </div>
                ) : visibleItems.length === 0 ? (
                    <div className="history-empty history-empty-drawer">
                        <div className="history-empty-copy">没有匹配「{searchText.trim()}」的会话。</div>
                    </div>
                ) : (
                    <div className="history-drawer-list">
                        {visibleItems.map((item) => {
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
                                                title={item.isPending ? "生成中，完成后可导出" : "导出为 Markdown"}
                                                aria-label={`导出会话 ${item.title} 为 Markdown`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void handleExport(item);
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.stopPropagation();
                                                        void handleExport(item);
                                                    }
                                                }}
                                            >
                                                {exportingId === item.id ? "…" : "⤓"}
                                            </span>
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
