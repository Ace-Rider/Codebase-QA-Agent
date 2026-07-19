import fs from "node:fs/promises";
import { resolveCodebaseFile } from "./workspace.js";

const MAX_CONTENT_LENGTH = 6000;
const MAX_BATCH_SIZE = 5;

export type ReadMultipleFilesItem = {
    filePath: string;
    content: string;
};

function truncateContent(content: string) {
    return content.length > MAX_CONTENT_LENGTH ? `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[truncated]` : content;
}

export async function readFileContent(filePath: string) {
    const fullPath = resolveCodebaseFile(filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return truncateContent(content);
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
