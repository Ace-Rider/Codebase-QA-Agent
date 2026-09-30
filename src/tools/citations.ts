import type { Citation, Step } from "../agent/run-agent.js";
import { toRelativePath } from "./workspace.js";

/**
 * 从工具执行轨迹提取「依据出处」：
 * read_file / read_multiple_files 按读取的文件记引用，
 * grep_files 按命中行记引用（file:line 去重）。
 */

type ReadMultipleFilesResult = {
    files?: Array<{
        filePath: string;
        content: string;
    }>;
};

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

function collectStepCitations(step: Step): Citation[] {
    if (step.tool_name === "read_file") {
        return [createReadCitation(step)].filter(Boolean) as Citation[];
    }

    if (step.tool_name === "read_multiple_files") {
        return createReadMultipleCitations(step);
    }

    if (step.tool_name === "grep_files") {
        return createGrepCitations(step);
    }

    return [];
}

export function buildCitations(steps: Step[]): Citation[] {
    const citations: Citation[] = [];
    const seen = new Set<string>();

    for (const step of steps) {
        if (step.status !== "success") {
            continue;
        }

        for (const citation of collectStepCitations(step)) {
            const dedupeKey = `${citation.source}:${citation.file_path}:${citation.line_number ?? "read"}`;

            if (seen.has(dedupeKey)) {
                continue;
            }

            seen.add(dedupeKey);
            citations.push(citation);
        }
    }

    return citations;
}
