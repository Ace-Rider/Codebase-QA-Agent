import fs from "node:fs";
import path from "node:path";

/**
 * 工作区根目录：默认是项目自身（可以问答本项目的代码），
 * 通过 WORKSPACE_ROOT 环境变量可指向任意目录（用它分析你自己的项目）。
 */
const PROJECT_ROOT = (() => {
    const configured = process.env.WORKSPACE_ROOT;

    if (!configured) {
        return path.resolve(".");
    }

    const resolved = path.resolve(configured);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`WORKSPACE_ROOT is not an existing directory: ${resolved}`);
    }

    return resolved;
})();

const DEFAULT_CODEBASE_ROOT = path.join(PROJECT_ROOT, "src");

function isWithin(parent: string, target: string) {
    const relative = path.relative(parent, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function getProjectRoot() {
    return PROJECT_ROOT;
}

export function getDefaultCodebaseRoot() {
    return DEFAULT_CODEBASE_ROOT;
}

export function resolveWithinProject(inputPath: string, baseDir = PROJECT_ROOT) {
    const resolved = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.resolve(baseDir, inputPath);

    if (!isWithin(PROJECT_ROOT, resolved)) {
        throw new Error("path is outside the project workspace");
    }

    return resolved;
}

export function resolveCodebaseRoot(rootDir?: string) {
    if (!rootDir) {
        return DEFAULT_CODEBASE_ROOT;
    }

    return resolveWithinProject(rootDir);
}

export function resolveCodebaseFile(filePath: string) {
    return resolveWithinProject(filePath);
}
