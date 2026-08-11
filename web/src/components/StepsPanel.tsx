import { useEffect, useMemo, useRef, useState } from "react";
import type { Step } from "../types/chat";

type StepsPanelProps = {
    steps: Step[];
    isStreaming: boolean;
    selectedEvidencePath: string | null;
};

type StepCardProps = {
    step: Step;
    displayIndex: number;
    isLatest: boolean;
    animate: boolean;
    highlighted: boolean;
};

type StepGroup = {
    iteration: number;
    items: Array<{
        step: Step;
        originalIndex: number;
    }>;
};

function normalizePathLike(value: string) {
    return value.replaceAll("\\", "/").trim();
}

function matchesPathCandidate(candidate: string, target: string) {
    const normalizedCandidate = normalizePathLike(candidate);
    const normalizedTarget = normalizePathLike(target);

    return normalizedCandidate === normalizedTarget || normalizedCandidate.endsWith(`/${normalizedTarget}`);
}

function extractStepPaths(step: Step) {
    const paths = new Set<string>();
    const toolArgs = (step.tool_args ?? {}) as {
        filePath?: string;
        filePaths?: string[];
    };

    if (typeof toolArgs.filePath === "string" && toolArgs.filePath) {
        paths.add(toolArgs.filePath);
    }

    if (Array.isArray(toolArgs.filePaths)) {
        for (const filePath of toolArgs.filePaths) {
            if (typeof filePath === "string" && filePath) {
                paths.add(filePath);
            }
        }
    }

    const toolResult = step.tool_result as {
        files?: Array<{ filePath: string }>;
        matches?: Array<{ filePath: string }>;
    };

    if (Array.isArray(toolResult.files)) {
        for (const file of toolResult.files) {
            if (typeof file?.filePath === "string" && file.filePath) {
                paths.add(file.filePath);
            }
        }
    }

    if (Array.isArray(toolResult.matches)) {
        for (const match of toolResult.matches) {
            if (typeof match?.filePath === "string" && match.filePath) {
                paths.add(match.filePath);
            }
        }
    }

    return [...paths];
}

function findFirstRelatedStepIndex(steps: Step[], selectedEvidencePath: string | null) {
    if (!selectedEvidencePath) {
        return -1;
    }

    return steps.findIndex((step) =>
        extractStepPaths(step).some((candidate) => matchesPathCandidate(candidate, selectedEvidencePath)),
    );
}

function groupStepsByIteration(steps: Step[]): StepGroup[] {
    const groups: StepGroup[] = [];

    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        const lastGroup = groups[groups.length - 1];

        if (!lastGroup || lastGroup.iteration !== step.iteration) {
            groups.push({
                iteration: step.iteration,
                items: [{ step, originalIndex: index }],
            });
            continue;
        }

        lastGroup.items.push({ step, originalIndex: index });
    }

    return groups;
}

function formatStepSummary(step: Step) {
    const args = (step.tool_args ?? {}) as Record<string, unknown>;

    switch (step.tool_name) {
        case "list_files":
            return `先查看目录 ${String(args.rootDir ?? "src")} 下有哪些关键文件。`;
        case "read_file":
            return `读取文件 ${String(args.filePath ?? "")}，补充更具体的实现细节。`;
        case "read_multiple_files":
            return `一次读取 ${Array.isArray(args.filePaths) ? args.filePaths.length : 0} 个文件，方便横向对比。`;
        case "grep_files":
            return `在 ${String(args.rootDir ?? "src")} 中搜索 ${JSON.stringify(String(args.query ?? ""))}。`;
        default:
            return `${step.tool_label || step.tool_name} 已执行，用来补充回答所需上下文。`;
    }
}

function StepCard({ step, displayIndex, isLatest, animate, highlighted }: StepCardProps) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [fullOpen, setFullOpen] = useState(false);
    const canToggleFull = Boolean(
        step.expandable &&
        step.tool_result_full_text &&
        step.tool_result_full_text !== step.tool_result_text,
    );

    useEffect(() => {
        setFullOpen(false);
    }, [step.tool_result_full_text, step.tool_result_text]);

    return (
        <article
            className={[
                "trace-card",
                detailsOpen ? "trace-card-open" : "",
                highlighted ? "trace-card-highlighted" : "",
                animate ? "step-enter" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <div className="trace-left">
                <div className="trace-step">Step {String(displayIndex + 1).padStart(2, "0")}</div>
                <div className="chip chip-strong">{step.tool_label || step.tool_name}</div>
            </div>

            <div className="trace-right">
                <div className="trace-head">
                    <div className="trace-head-main">
                        <strong>{formatStepSummary(step)}</strong>
                        <div className="trace-meta">
                            <span className={step.status === "error" ? "trace-error" : "trace-success"}>
                                {step.status_label || step.status}
                            </span>
                            <span>{step.duration_text || `${step.duration_ms} ms`}</span>
                            {isLatest ? <span className="trace-live">进行中</span> : null}
                            {highlighted ? <span className="trace-linked">已定位</span> : null}
                        </div>
                    </div>

                    <button
                        className="trace-toggle-btn"
                        type="button"
                        onClick={() => setDetailsOpen((value) => !value)}
                    >
                        {detailsOpen ? "收起详情" : "查看详情"}
                    </button>
                </div>

                {detailsOpen ? (
                    <>
                        <div className="trace-grid">
                            <div className="trace-field trace-field-args">
                                <div className="field-label">参数</div>
                                <pre className="trace-code trace-code-args">{step.tool_args_text || "无参数"}</pre>
                            </div>

                            <div className="trace-field trace-field-result">
                                <div className="field-label">结果预览</div>
                                <pre className="trace-code trace-code-result preview-box">{step.tool_result_text || ""}</pre>
                            </div>
                        </div>

                        {canToggleFull ? (
                            <>
                                <button
                                    className="toggle-btn"
                                    type="button"
                                    onClick={() => setFullOpen((value) => !value)}
                                >
                                    {fullOpen ? "收起完整内容" : "查看完整内容"}
                                </button>
                                {fullOpen ? (
                                    <pre className="trace-code trace-code-result full-result-box">
                                        {step.tool_result_full_text}
                                    </pre>
                                ) : null}
                            </>
                        ) : null}
                    </>
                ) : null}
            </div>
        </article>
    );
}

export function StepsPanel({ steps, isStreaming, selectedEvidencePath }: StepsPanelProps) {
    const previousCountRef = useRef(0);
    const [animatedIndex, setAnimatedIndex] = useState<number | null>(null);
    const [expanded, setExpanded] = useState(() => isStreaming);
    const stepRefs = useRef<Array<HTMLDivElement | null>>([]);
    const lastScrolledPathRef = useRef<string | null>(null);
    const relatedStepIndex = useMemo(
        () => findFirstRelatedStepIndex(steps, selectedEvidencePath),
        [steps, selectedEvidencePath],
    );
    const stepGroups = useMemo(() => groupStepsByIteration(steps), [steps]);

    useEffect(() => {
        if (isStreaming) {
            setExpanded(true);
        }
    }, [isStreaming]);

    useEffect(() => {
        if (steps.length === 0) {
            previousCountRef.current = 0;
            setAnimatedIndex(null);
            return;
        }

        if (steps.length > previousCountRef.current) {
            setAnimatedIndex(steps.length - 1);
            previousCountRef.current = steps.length;

            const timeout = window.setTimeout(() => {
                setAnimatedIndex(null);
            }, 320);

            return () => {
                window.clearTimeout(timeout);
            };
        }

        previousCountRef.current = steps.length;
    }, [steps]);

    useEffect(() => {
        if (!selectedEvidencePath) {
            lastScrolledPathRef.current = null;
            return;
        }

        if (lastScrolledPathRef.current === selectedEvidencePath) {
            return;
        }

        if (relatedStepIndex === -1) {
            return;
        }

        setExpanded(true);

        const timeout = window.setTimeout(() => {
            stepRefs.current[relatedStepIndex]?.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        }, 80);

        lastScrolledPathRef.current = selectedEvidencePath;

        return () => {
            window.clearTimeout(timeout);
        };
    }, [relatedStepIndex, selectedEvidencePath]);

    if (steps.length === 0 && !isStreaming) {
        return null;
    }

    return (
        <section className={["turn-section", expanded ? "turn-section-open" : ""].filter(Boolean).join(" ")}>
            <button className="turn-section-head" type="button" onClick={() => setExpanded((value) => !value)}>
                <span className="turn-section-title">执行轨迹</span>
                <span className="turn-section-meta">{steps.length} 步</span>
                {isStreaming ? <span className="turn-section-live">执行中</span> : null}
                <span className="turn-section-toggle">{expanded ? "收起" : "展开"}</span>
            </button>

            {expanded ? (
                <div className="turn-section-body">
                    {steps.length === 0 ? (
                        <div className="empty-state">{isStreaming ? "正在等待工具调用..." : "还没有工具执行记录。"}</div>
                    ) : (
                        <div className="trace-groups">
                            {stepGroups.map((group) => {
                                const isActiveGroup =
                                    relatedStepIndex !== -1 &&
                                    group.items.some((item) => item.originalIndex === relatedStepIndex);
                                const isLatestGroup =
                                    isStreaming && group.items.some((item) => item.originalIndex === steps.length - 1);

                                return (
                                    <section
                                        key={`iteration-${group.iteration}`}
                                        className={["trace-group", isActiveGroup ? "trace-group-active" : ""]
                                            .filter(Boolean)
                                            .join(" ")}
                                    >
                                        <div className="trace-group-head">
                                            <div className="trace-group-title">
                                                <span className="trace-group-badge">第 {group.iteration} 轮</span>
                                                <span className="trace-group-note">{group.items.length} 个步骤</span>
                                                {isActiveGroup ? <span className="trace-group-linked">已定位</span> : null}
                                            </div>
                                            {isLatestGroup ? <span className="trace-group-live">本轮进行中</span> : null}
                                        </div>

                                        <div className="trace-list">
                                            {group.items.map(({ step, originalIndex }) => (
                                                <div
                                                    key={`${step.iteration}-${step.tool_name}-${step.duration_ms}-${originalIndex}`}
                                                    className="trace-anchor"
                                                    ref={(node) => {
                                                        stepRefs.current[originalIndex] = node;
                                                    }}
                                                >
                                                    <StepCard
                                                        step={step}
                                                        displayIndex={originalIndex}
                                                        isLatest={isStreaming && originalIndex === steps.length - 1}
                                                        animate={animatedIndex === originalIndex}
                                                        highlighted={originalIndex === relatedStepIndex}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : null}
        </section>
    );
}
