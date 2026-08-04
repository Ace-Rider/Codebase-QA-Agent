import path from "node:path";
import type { ChatResponse, Citation, Step } from "../agent/run-agent.js";
import { getProjectRoot } from "./workspace.js";

type FormattedResult = {
    text: string;
    fullText?: string;
    expandable?: boolean;
};

type ReadMultipleFilesResult = {
    files?: Array<{
        filePath: string;
        content: string;
    }>;
};

const TOOL_LABELS: Record<string, string> = {
    list_files: "列出文件",
    read_file: "读取文件",
    read_multiple_files: "批量读取文件",
    grep_files: "搜索文件",
};

const STATUS_LABELS: Record<string, string> = {
    success: "成功",
    error: "失败",
};

const PROJECT_ROOT = getProjectRoot();

function toRelativePath(inputPath: string) {
    if (!inputPath) {
        return "";
    }

    const resolved = path.isAbsolute(inputPath) ? inputPath : path.resolve(PROJECT_ROOT, inputPath);
    return path.relative(PROJECT_ROOT, resolved).replaceAll("\\", "/");
}

function splitTableLine(line: string) {
    return line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
}

function isTableDivider(line: string) {
    return /^[:\-\|\s]+$/.test(line.trim());
}

function simplifyMarkdownTables(text: string) {
    const lines = text.split(/\r?\n/);
    const output: string[] = [];

    for (let index = 0; index < lines.length; index++) {
        const currentLine = lines[index] ?? "";
        const nextLine = lines[index + 1];

        if (currentLine.includes("|") && nextLine && isTableDivider(nextLine)) {
            const headers = splitTableLine(currentLine);
            index += 2;

            while (index < lines.length) {
                const rowLine = lines[index];

                if (!rowLine || !rowLine.includes("|")) {
                    break;
                }

                const cells = splitTableLine(rowLine);
                if (cells.length > 0) {
                    output.push(
                        cells
                            .map((value, cellIndex) => `${headers[cellIndex] ?? `Field ${cellIndex + 1}`}: ${value}`)
                            .join(" | "),
                    );
                }

                index++;
            }

            index--;
            continue;
        }

        output.push(currentLine);
    }

    return output.join("\n");
}

function unwrapWholeMarkdownFence(text: string) {
    let current = text.trim();

    for (let index = 0; index < 3; index++) {
        const match = current.match(/^```[\w-]*[^\S\r\n]*\n([\s\S]*?)\n```$/);
        if (!match?.[1]) {
            break;
        }
        current = match[1].trim();
    }

    return current;
}

function cleanAnswer(text: string) {
    return unwrapWholeMarkdownFence(simplifyMarkdownTables(text))
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function formatArgs(args: unknown) {
    if (!args || typeof args !== "object") {
        return "无参数";
    }

    const entries = Object.entries(args as Record<string, unknown>);
    const priority = ["rootDir", "filePath", "filePaths", "query"];

    entries.sort(([leftKey], [rightKey]) => {
        const leftIndex = priority.indexOf(leftKey);
        const rightIndex = priority.indexOf(rightKey);

        if (leftIndex === -1 && rightIndex === -1) {
            return leftKey.localeCompare(rightKey);
        }
        if (leftIndex === -1) {
            return 1;
        }
        if (rightIndex === -1) {
            return -1;
        }

        return leftIndex - rightIndex;
    });

    return entries
        .map(([key, value]) => {
            if (Array.isArray(value)) {
                return `${key}:\n${value.map((item) => `- ${String(item)}`).join("\n")}`;
            }

            return `${key}: ${String(value)}`;
        })
        .join("\n");
}

function buildReadPreview(content: string): FormattedResult {
    const lines = content.split(/\r?\n/);
    const previewLines = lines.slice(0, 24);
    const preview = previewLines.join("\n").trim();
    const expandable = lines.length > 24 || content.length > 1200;

    if (!expandable) {
        return {
            text: preview || "空文件。",
            fullText: content,
            expandable: false,
        };
    }

    const previewText = preview.slice(0, 1200);

    return {
        text: `${previewText}\n\n...已截断，原内容约 ${lines.length} 行`,
        fullText: content,
        expandable: true,
    };
}

function formatListResult(result: unknown): FormattedResult {
    const listResult = result as { files?: string[]; total?: number; truncated?: boolean };
    const files = listResult?.files ?? [];

    if (!Array.isArray(files) || files.length === 0) {
        return { text: "没有找到文件。" };
    }

    const totalCount = typeof listResult?.total === "number" ? listResult.total : files.length;

    const preview = files
        .slice(0, 20)
        .map((file) => `- ${file}`)
        .join("\n");

    const hiddenCount = files.length - 20;
    const suffix =
        hiddenCount > 0
            ? `\n...以及另外 ${hiddenCount} 个文件${listResult?.truncated ? `（共 ${totalCount} 个，已截断）` : ""}`
            : "";

    return {
        text: `${totalCount} 个文件\n${preview}${suffix}`,
    };
}

function formatReadResult(result: unknown): FormattedResult {
    const content = (result as { content?: string })?.content ?? "";

    if (!content) {
        return {
            text: "空文件。",
            fullText: "",
            expandable: false,
        };
    }

    return buildReadPreview(content);
}

function formatReadMultipleResult(result: unknown): FormattedResult {
    const files = (result as ReadMultipleFilesResult)?.files ?? [];

    if (!Array.isArray(files) || files.length === 0) {
        return {
            text: "没有读取到文件。",
            fullText: "",
            expandable: false,
        };
    }

    const sections = files.map((item) => {
        const relativePath = toRelativePath(item.filePath);
        return `# ${relativePath}\n\n${item.content}`;
    });

    const fullText = sections.join("\n\n");
    const previewSections = sections.slice(0, 3);
    const previewText = previewSections.join("\n\n");
    const hiddenCount = files.length - previewSections.length;
    const expandable = files.length > 3 || fullText.length > 1800;

    if (!expandable) {
        return {
            text: previewText,
            fullText,
            expandable: false,
        };
    }

    const suffix = hiddenCount > 0 ? `\n\n...以及另外 ${hiddenCount} 个文件` : "";

    return {
        text: `${previewText.slice(0, 1800)}${suffix}`,
        fullText,
        expandable: true,
    };
}

function formatGrepResult(result: unknown): FormattedResult {
    const matches =
        (result as { matches?: Array<{ filePath: string; lineNumber: number; lineText: string }> })?.matches ?? [];

    if (!Array.isArray(matches) || matches.length === 0) {
        return { text: "没有匹配结果。" };
    }

    const preview = matches
        .slice(0, 20)
        .map((item) => `- ${toRelativePath(item.filePath)}:${item.lineNumber} ${item.lineText}`)
        .join("\n");

    const suffix = matches.length > 20 ? `\n...以及另外 ${matches.length - 20} 条匹配` : "";

    return {
        text: `${matches.length} 条匹配\n${preview}${suffix}`,
    };
}

function formatDefaultResult(result: unknown): FormattedResult {
    return {
        text: JSON.stringify(result, null, 2),
    };
}

function formatToolResult(toolName: string, result: unknown): FormattedResult {
    switch (toolName) {
        case "list_files":
            return formatListResult(result);
        case "read_file":
            return formatReadResult(result);
        case "read_multiple_files":
            return formatReadMultipleResult(result);
        case "grep_files":
            return formatGrepResult(result);
        default:
            return formatDefaultResult(result);
    }
}

function normalizeStep(step: Step) {
    const toolName = step.tool_name ?? "unknown_tool";
    const resultDisplay = formatToolResult(toolName, step.tool_result);

    const normalizedStep = {
        ...step,
        tool_label: TOOL_LABELS[toolName] ?? toolName,
        status_label: STATUS_LABELS[step.status] ?? step.status,
        duration_text: `${step.duration_ms} ms`,
        tool_args_text: formatArgs(step.tool_args),
        tool_result_text: resultDisplay.text,
        expandable: resultDisplay.expandable ?? false,
    };

    if (resultDisplay.fullText !== undefined) {
        return {
            ...normalizedStep,
            tool_result_full_text: resultDisplay.fullText,
        };
    }

    return normalizedStep;
}

function createReadCitationFromPath(filePath: string, reason: string): Citation {
    const relativePath = toRelativePath(filePath);

    return {
        file_path: relativePath,
        source: "read_file",
        reason,
    };
}

function createReadCitation(step: Step): Citation | null {
    const filePath = (step.tool_args as { filePath?: string })?.filePath;

    if (!filePath) {
        return null;
    }

    return createReadCitationFromPath(filePath, "Agent 读取了这个文件，用来补充更具体的代码上下文。");
}

function createReadMultipleCitations(step: Step) {
    const files = (step.tool_result as ReadMultipleFilesResult)?.files ?? [];

    if (!Array.isArray(files) || files.length === 0) {
        return [];
    }

    return files.map((item) =>
        createReadCitationFromPath(item.filePath, "Agent 批量读取了这些文件，用来同时分析多个代码上下文。"),
    );
}

function createGrepCitations(step: Step) {
    const matches =
        (step.tool_result as { matches?: Array<{ filePath: string; lineNumber: number; lineText: string }> })?.matches ?? [];

    if (!Array.isArray(matches) || matches.length === 0) {
        return [];
    }

    const seen = new Set<string>();
    const citations: Citation[] = [];

    for (const match of matches) {
        const relativePath = toRelativePath(match.filePath);
        const dedupeKey = `${relativePath}:${match.lineNumber}`;

        if (seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        citations.push({
            file_path: relativePath,
            source: "grep_files",
            line_number: match.lineNumber,
            excerpt: match.lineText,
            reason: "Agent 在这个文件里搜索到了与问题直接相关的文本命中。",
        });
    }

    return citations;
}

function buildCitations(steps: Step[]) {
    const citations: Citation[] = [];
    const seen = new Set<string>();

    for (const step of steps) {
        if (step.status !== "success") {
            continue;
        }

        const currentCitations =
            step.tool_name === "read_file"
                ? [createReadCitation(step)].filter(Boolean)
                : step.tool_name === "read_multiple_files"
                  ? createReadMultipleCitations(step)
                  : step.tool_name === "grep_files"
                    ? createGrepCitations(step)
                    : [];

        for (const citation of currentCitations) {
            const item = citation as Citation;
            const dedupeKey = `${item.source}:${item.file_path}:${item.line_number ?? "read"}`;

            if (seen.has(dedupeKey)) {
                continue;
            }

            seen.add(dedupeKey);
            citations.push(item);
        }
    }

    return citations;
}

export function normalizeResult(result: ChatResponse): ChatResponse {
    const normalizedSteps = result.steps.map(normalizeStep);
    const citations = result.citations.length > 0 ? result.citations : buildCitations(result.steps);

    return {
        ...result,
        answer: cleanAnswer(result.answer),
        steps: normalizedSteps,
        citations,
    };
}
