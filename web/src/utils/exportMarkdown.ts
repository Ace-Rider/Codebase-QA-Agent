import type { ChatTurn } from "../types/chat";

/**
 * 会话导出：把一轮轮问答（含工具轨迹与依据出处）拼成 Markdown 文件下载。
 * 与 UI 组件解耦——组件只负责取数，导出格式集中在这里维护。
 */

function buildCitationLine(citation: ChatTurn["citations"][number]) {
    const location = citation.line_number ? ` L${citation.line_number}` : "";
    return `- \`${citation.file_path}\`${location}`;
}

function buildTurnSection(turn: ChatTurn, index: number) {
    const lines: string[] = [`## 问 ${index + 1}：${turn.question}`, ""];

    if (turn.error) {
        lines.push(`> ⚠️ 此轮出现错误：${turn.error}`, "");
    }

    if (turn.answer) {
        lines.push(turn.answer, "");
    }

    if (turn.steps.length > 0) {
        const stepLines = turn.steps.map(
            (step) =>
                `- 第 ${step.iteration} 轮 · ${step.tool_label || step.tool_name}${
                    step.status === "error" ? "（失败）" : ""
                }`,
        );
        lines.push("**工具轨迹**", "", ...stepLines, "");
    }

    if (turn.citations.length > 0) {
        lines.push("**依据出处**", "", ...turn.citations.map(buildCitationLine), "");
    }

    return lines.join("\n");
}

function buildConversationMarkdown(title: string, turns: ChatTurn[]) {
    const exportedAt = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "long",
        timeStyle: "short",
    }).format(new Date());

    return [
        `# ${title}`,
        "",
        `> 由 Codebase QA Agent · 夜读 导出于 ${exportedAt}`,
        "",
        turns.map(buildTurnSection).join("\n---\n\n"),
        "",
    ].join("\n");
}

function sanitizeFilename(name: string) {
    return name.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 50) || "conversation";
}

export function downloadConversationMarkdown(title: string, turns: ChatTurn[]) {
    const blob = new Blob([buildConversationMarkdown(title, turns)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFilename(title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
}
