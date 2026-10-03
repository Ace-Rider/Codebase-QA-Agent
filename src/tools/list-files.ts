import fg from "fast-glob";
import { resolveCodebaseRoot } from "./workspace.js";

// 注意：与 grep-files.ts 的忽略列表刻意不同——列目录要展示仓库结构（package-lock.json 属于结构的一部分），
// 而 grep 扫 lock 文件是纯噪声，所以那边多忽略它
const IGNORE_PATTERNS = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/coverage/**",
    "**/.git/**",
    "**/.idea/**",
    "**/.vscode/**",
    "**/dev.db",
    "**/*.{png,jpg,jpeg,gif,webp,ico,pdf,zip}",
];

const MAX_FILES = 400;

export async function listFiles(dir: string) {
    const cwd = resolveCodebaseRoot(dir);
    const entries = await fg(["**/*"], {
        cwd,
        onlyFiles: true,
        dot: false,
        ignore: IGNORE_PATTERNS,
        suppressErrors: true,
    });

    const files = entries.sort();

    return {
        files: files.slice(0, MAX_FILES),
        total: files.length,
        truncated: files.length > MAX_FILES,
    };
}
