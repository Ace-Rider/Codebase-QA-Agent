import fs from "node:fs/promises";
import { resolveCodebaseFile } from "./workspace.js";

const MAX_CONTENT_LENGTH = 6000;
const MAX_BATCH_SIZE = 5;
const DEFAULT_RANGE_LINES = 100;
const MAX_RANGE_LINES = 400;

export type ReadMultipleFilesItem = {
    filePath: string;
    content: string;
};

export type ReadFileRange = {
    /** 1-based 起始行号 */
    offset?: number | undefined;
    /** 读取行数 */
    limit?: number | undefined;
};

function truncateContent(content: string) {
    return content.length > MAX_CONTENT_LENGTH ? `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[truncated]` : content;
}

export async function readFileContent(filePath: string, range: ReadFileRange = {}) {
    const fullPath = resolveCodebaseFile(filePath);
    const raw = await fs.readFile(fullPath, "utf-8");

    const hasRange = typeof range.offset === "number" || typeof range.limit === "number";

    if (!hasRange) {
        return truncateContent(raw);
    }

    // 按行读取：输出带行号，便于模型引用与后续按范围继续读
    const lines = raw.split(/\r?\n/);
    const total = lines.length;
    const offset = Math.max(1, Math.floor(range.offset ?? 1));
    const limit = Math.min(Math.max(1, Math.floor(range.limit ?? DEFAULT_RANGE_LINES)), MAX_RANGE_LINES);
    const end = Math.min(offset + limit - 1, total);
    const slice = lines.slice(offset - 1, end);

    if (slice.length === 0) {
        return `[empty range] file has ${total} lines, requested from line ${offset}`;
    }

    const numbered = slice.map((line, index) => `${offset + index}: ${line}`).join("\n");
    return `${numbered}\n\n[lines ${offset}-${end} of ${total}]`;
}

export async function readMultipleFilesContent(filePaths: string[]): Promise<ReadMultipleFilesItem[]> {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        throw new Error("No file paths provided");
    }

    const uniquePaths = [...new Set(filePaths)];

    if (uniquePaths.length > MAX_BATCH_SIZE) {
        throw new Error(`Too many files requested. Maximum allowed is ${MAX_BATCH_SIZE}`);
    }

    return Promise.all(
        uniquePaths.map(async (filePath) => ({
            filePath,
            content: await readFileContent(filePath),
        })),
    );
}
