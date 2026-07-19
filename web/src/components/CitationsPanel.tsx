import type { Citation } from "../types/chat";

type CitationsPanelProps = {
    citations: Citation[];
    isLoading: boolean;
    selectedFilePath: string | null;
    onSelectFilePath: (filePath: string) => void;
};

export function CitationsPanel({
    citations,
    isLoading,
    selectedFilePath,
    onSelectFilePath,
}: CitationsPanelProps) {
    const groupedCitations = citations.reduce<Record<string, Citation[]>>((groups, citation) => {
        const key = citation.file_path;
        groups[key] ||= [];
        groups[key].push(citation);
        return groups;
    }, {});

    const citationGroups = Object.entries(groupedCitations);

    return (
        <section className="panel section-panel">
            <div className="section-head">
                <div>
                    <div className="panel-kicker">Evidence</div>
                    <h2>证据</h2>
                </div>
                <div className="panel-counter">{citations.length} 条</div>
            </div>

            {citations.length === 0 ? (
                <div className="empty-state">
                    {isLoading ? "正在等待引用信息..." : "还没有可展示的证据。"}
                </div>
            ) : (
                <div className="evidence-list">
                    {citationGroups.map(([filePath, items]) => {
                        const isSelected = selectedFilePath === filePath;

                        return (
                            <article
                                key={filePath}
                                className={["evidence-card", isSelected ? "evidence-card-selected" : ""]
                                    .filter(Boolean)
                                    .join(" ")}
                            >
                                <div className="evidence-top">
                                    <span className="chip">
                                        {items.some((item) => item.source === "grep_files") ? "搜索命中" : "读取文件"}
                                    </span>
                                    <span className="panel-counter panel-counter-small">{items.length} 条</span>
                                </div>

                                <strong>{filePath}</strong>
                                {isSelected ? <div className="evidence-linked-note">已在执行轨迹中定位相关步骤</div> : null}

                                <div className="evidence-body">
                                    {items.map((citation) => (
                                        <div
                                            key={`${citation.source}:${citation.file_path}:${citation.line_number ?? "read"}`}
                                            className="evidence-entry"
                                        >
                                            {citation.reason ? <p>{citation.reason}</p> : null}
                                            {citation.line_number ? (
                                                <div className="evidence-meta">第 {citation.line_number} 行</div>
                                            ) : null}
                                            {citation.excerpt ? <pre>{citation.excerpt}</pre> : null}
                                        </div>
                                    ))}
                                </div>

                                <button
                                    className={[
                                        "evidence-link-btn",
                                        isSelected ? "evidence-link-btn-selected" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    type="button"
                                    onClick={() => onSelectFilePath(filePath)}
                                >
                                    {isSelected ? "已定位，点击取消" : "定位相关步骤"}
                                </button>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
