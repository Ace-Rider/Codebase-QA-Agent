import type { ChatResponse } from "../agent/run-agent.js";
import { buildCitations } from "./citations.js";
import { normalizeStep } from "./format-step.js";

/**
 * 结果归一化入口：
 * - 答案清洗（Markdown 表格简化、去掉整体代码围栏、压缩空行）
 * - 步骤格式化（委托 format-step）
 * - 引用提取（已有引用则保留，否则从工具轨迹提取，委托 citations）
 */

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
