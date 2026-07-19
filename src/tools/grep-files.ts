import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { resolveCodebaseRoot } from "./workspace.js";

type GrepMatch = {
    filePath: string;
    lineNumber: number;
    lineText: string;
};

export async function grepFiles(rootDir: string, query: string) {
    const cwd = resolveCodebaseRoot(rootDir);
    const files = await fg(["**/*.{ts,tsx,js,jsx,json,md}"], {
        cwd,
        onlyFiles: true,
        dot: false,
    });

    const results: GrepMatch[] = [];

    for (const relativePath of files) {
        const fullPath = path.join(cwd, relativePath);

        let content = "";
        try {
            content = await fs.readFile(fullPath, "utf-8");
        } catch {
            continue;
        }

        const lines = content.split(/\r?\n/);

        lines.forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                    filePath: fullPath,
                    lineNumber: index + 1,
                    lineText: line.trim(),
                });
            }
        });
    }

    return results.slice(0, 50);
}
