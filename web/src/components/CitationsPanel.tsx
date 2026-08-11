import { useEffect, useState } from "react";
import { fetchFilePreview } from "../services/chat";
import type { Citation } from "../types/chat";

type CitationsPanelProps = {
    citations: Citation[];
    isStreaming: boolean;
    selectedFilePath: string | null;
    onSelectFilePath: (filePath: string) => void;
    /** 脚注锚点 id 前缀（一般传 turn.id），供正文 [n] 引用滚动定位 */
    footnoteBaseId?: string;
    /** 正文中刚被点击的脚注编号（从 1 开始），对应条目短暂高亮 */
    flashFootnote?: number | null;
};

const MAX_PREVIEW_LINES = 400;

type PreviewState = {
    loading: boolean;
    error: string | null;
    content: string | null;
};

function CodePreview({ filePath, citedLines }: { filePath: string; citedLines: number[] }) {
    const [state, setState] = useState<PreviewState>({ loading: true, error: null, content: null });

    useEffect(() => {
        let cancelled = false;

        setState({ loading: true, error: null, content: null });

        fetchFilePreview(filePath)
            .then((file) => {
                if (!cancelled) {
                    setState({ loading: false, error: null, content: file.content });
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setState({
                        loading: false,
                        error: error instanceof Error ? error.message : "读取文件失败",
                        content: null,
                    });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [filePath]);

    if (state.loading) {
        return <div className="code-preview-loading">正在加载代码...</div>;
    }

    if (state.error || state.content === null) {
        return <div className="code-preview-error">{state.error || "读取文件失败"}</div>;
    }

    const lines = state.content.split(/\r?\n/);
    const visibleLines = lines.slice(0, MAX_PREVIEW_LINES);
    const citedSet = new Set(citedLines);

    return (
        <div className="code-preview">
            {visibleLines.map((line, index) => {
                const lineNumber = index + 1;

                return (
                    <div
                        key={lineNumber}
                        className={citedSet.has(lineNumber) ? "code-line code-line-hit" : "code-line"}
                    >
                        <span className="code-line-no">{lineNumber}</span>
                        <span className="code-line-text">{line || " "}</span>
                    </div>
                );
            })}
            {lines.length > MAX_PREVIEW_LINES ? (
                <div className="code-preview-more">...共 {lines.length} 行，仅展示前 {MAX_PREVIEW_LINES} 行</div>
            ) : null}
        </div>
    );
}

export function CitationsPanel({
    citations,
    isStreaming,
    selectedFilePath,
    onSelectFilePath,
    footnoteBaseId,
    flashFootnote,
}: CitationsPanelProps) {
    const [expandedPath, setExpandedPath] = useState<string | null>(null);

    useEffect(() => {
        if (expandedPath && !citations.some((citation) => citation.file_path === expandedPath)) {
            setExpandedPath(null);
        }
    }, [citations, expandedPath]);

    const groupedCitations = citations.reduce<Record<string, Citation[]>>((groups, citation) => {
        const key = citation.file_path;
        groups[key] ||= [];
        groups[key].push(citation);
        return groups;
    }, {});

    const citationGroups = Object.entries(groupedCitations);

    if (citationGroups.length === 0 && !isStreaming) {
        return null;
    }

    return (
        <section className="turn-section">
            <div className="turn-section-head turn-section-head-static">
                <span className="turn-section-title">依据出处</span>
                <span className="turn-section-meta">{citations.length} 条</span>
            </div>

            <div className="turn-section-body">
                {citationGroups.length === 0 ? (
                    <div className="empty-state">{isStreaming ? "正在等待引用信息..." : "还没有可展示的证据。"}</div>
                ) : (
                    <div className="evidence-list">
                        {citationGroups.map(([filePath, items], groupIndex) => {
                            const isSelected = selectedFilePath === filePath;
                            const isCodeOpen = expandedPath === filePath;
                            const citedLines = items
                                .map((item) => item.line_number)
                                .filter((lineNumber): lineNumber is number => typeof lineNumber === "number");
                            const sourceLabel = items.some((item) => item.source === "grep_files")
                                ? "搜索命中"
                                : "读取文件";

                            return (
                                <article
                                    key={filePath}
                                    id={footnoteBaseId ? `${footnoteBaseId}-fn-${groupIndex + 1}` : undefined}
                                    className={[
                                        "evidence-card",
                                        isSelected ? "evidence-card-selected" : "",
                                        flashFootnote === groupIndex + 1 ? "evidence-card-flash" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                >
                                    <span className="evidence-no">[{groupIndex + 1}]</span>

                                    <div className="evidence-main">
                                        <strong>{filePath}</strong>
                                        <span className="evidence-source">
                                            {sourceLabel} · {items.length} 条
                                        </span>
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

                                    <div className="evidence-actions">
                                        <button
                                            className={["evidence-link-btn", isSelected ? "evidence-link-btn-selected" : ""]
                                                .filter(Boolean)
                                                .join(" ")}
                                            type="button"
                                            onClick={() => onSelectFilePath(filePath)}
                                        >
                                            {isSelected ? "已定位，点击取消" : "定位相关步骤"}
                                        </button>

                                        <button
                                            className={["evidence-link-btn", isCodeOpen ? "evidence-link-btn-selected" : ""]
                                                .filter(Boolean)
                                                .join(" ")}
                                            type="button"
                                            onClick={() => setExpandedPath((current) => (current === filePath ? null : filePath))}
                                        >
                                            {isCodeOpen ? "收起代码" : "查看代码"}
                                        </button>
                                    </div>

                                    {isCodeOpen ? <CodePreview filePath={filePath} citedLines={citedLines} /> : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}
