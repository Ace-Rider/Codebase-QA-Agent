import fg from "fast-glob";
import { resolveCodebaseRoot } from "./workspace.js";

export async function listFiles(dir: string) {
    const cwd = resolveCodebaseRoot(dir);
    const entries = await fg(["**/*"], {
        cwd,
        onlyFiles: true,
        dot: false,
    });

    return entries;
}
