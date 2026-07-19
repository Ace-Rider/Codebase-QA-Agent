import { listFiles } from "../tools/list-files.js";
import { readFileContent, readMultipleFilesContent } from "../tools/read-file.js";
import { grepFiles } from "../tools/grep-files.js";
import { getDefaultCodebaseRoot } from "../tools/workspace.js";

const DEFAULT_ROOT = getDefaultCodebaseRoot();

type ToolArgs = {
    rootDir?: string;
    filePath?: string;
    filePaths?: string[];
    query?: string;
};

export async function runTool(name: string, args: ToolArgs) {
    switch (name) {
        case "list_files": {
            const rootDir = args.rootDir ?? DEFAULT_ROOT;
            const files = await listFiles(rootDir);
            return { files };
        }

        case "read_file": {
            if (!args.filePath) {
                throw new Error("No file path provided");
            }
            const content = await readFileContent(args.filePath);
            return { content };
        }

        case "read_multiple_files": {
            if (!Array.isArray(args.filePaths) || args.filePaths.length === 0) {
                throw new Error("No file paths provided");
            }
            const files = await readMultipleFilesContent(args.filePaths);
            return { files };
        }

        case "grep_files": {
            if (!args.query) {
                throw new Error("No query provided");
            }
            const rootDir = args.rootDir ?? DEFAULT_ROOT;
            const matches = await grepFiles(rootDir, args.query);
            return { matches };
        }

        default:
            throw new Error(`unknown tool: ${name}`);
    }
}
