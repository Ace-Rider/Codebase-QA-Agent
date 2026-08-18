import { describe, expect, it } from "vitest";
import { readFileContent } from "../src/tools/read-file.js";

// package.json 行数少且内容稳定，作为测试样本
describe("readFileContent 行号范围", () => {
    it("不传 range 时返回原始内容（无行号）", async () => {
        const content = await readFileContent("package.json");

        expect(content).toContain('"name"');
        expect(content.startsWith("1: ")).toBe(false);
        expect(content).not.toContain("[lines ");
    });

    it("offset + limit 返回带行号的切片与尾注", async () => {
        const content = await readFileContent("package.json", { offset: 1, limit: 3 });
        const lines = content.split("\n");

        expect(lines[0]?.startsWith("1: ")).toBe(true);
        expect(lines[1]?.startsWith("2: ")).toBe(true);
        expect(lines[2]?.startsWith("3: ")).toBe(true);
        expect(content).toMatch(/\[lines 1-3 of \d+\]$/);
    });

    it("从中间偏移读取时行号连续", async () => {
        const content = await readFileContent("package.json", { offset: 5, limit: 2 });
        const lines = content.split("\n");

        expect(lines[0]?.startsWith("5: ")).toBe(true);
        expect(lines[1]?.startsWith("6: ")).toBe(true);
        expect(content).toMatch(/\[lines 5-6 of \d+\]$/);
    });

    it("offset 超出文件长度时返回提示而不是报错", async () => {
        const content = await readFileContent("package.json", { offset: 99999, limit: 10 });

        expect(content).toContain("[empty range]");
    });

    it("limit 超过上限时被钳制到 400 行", async () => {
        const content = await readFileContent("src/agent/run-agent.ts", { offset: 1, limit: 99999 });

        // 尾注的 end 不应超过 400（或文件实际行数）
        const match = content.match(/\[lines 1-(\d+) of (\d+)\]$/);
        expect(match).not.toBeNull();

        const end = Number(match?.[1]);
        const total = Number(match?.[2]);
        expect(end).toBe(Math.min(400, total));
    });

    it("只传 offset 不传 limit 时使用默认 100 行", async () => {
        const content = await readFileContent("src/agent/run-agent.ts", { offset: 1 });

        const match = content.match(/\[lines 1-(\d+) of /);
        expect(Number(match?.[1])).toBe(100);
    });
});
