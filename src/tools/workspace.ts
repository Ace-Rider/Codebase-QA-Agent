import path from "node:path";

const PROJECT_ROOT = path.resolve(".");
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
