import type { ConversationHistoryItem } from "../types/chat";

type HistorySidebarProps = {
    items: ConversationHistoryItem[];
    activeHistoryId: string | null;
    disabled: boolean;
    isOpen: boolean;
    onSelectHistory: (item: ConversationHistoryItem) => void;
    onClose: () => void;
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

export function HistorySidebar({
    items,
    activeHistoryId,
    disabled,
    isOpen,
    onSelectHistory,
    onClose,
}: HistorySidebarProps) {
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

                            return (
                                <button
                                    key={item.id}
                                    className={[
                                        "history-item",
                                        isActive ? "history-item-active" : "",
                                        item.isPending ? "history-item-pending" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    type="button"
                                    onClick={() => onSelectHistory(item)}
                                    disabled={disabled}
                                >
                                    <div className="history-item-top">
                                        <strong>{item.title}</strong>
                                        <span className="history-item-time">{formatHistoryTime(item.updatedAt)}</span>
                                    </div>
                                    <div className="history-item-preview">{buildHistoryPreview(item)}</div>
                                    <div className="history-item-footer">
                                        <div className="history-item-meta">{buildHistoryMeta(item)}</div>
                                        {isActive ? (
                                            <span className="history-item-badge">{item.isPending ? "当前会话" : "已选中"}</span>
                                        ) : null}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </aside>
        </>
    );
}
