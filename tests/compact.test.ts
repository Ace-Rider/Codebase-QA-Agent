import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentStream } from "../src/agent/run-agent.js";
import { callModelWithToolsStream } from "../src/lib/model.js";

vi.mock("../src/lib/model.js", () => ({
    callModelWithToolsStream: vi.fn(),
}));

const mockCallModel = vi.mocked(callModelWithToolsStream);

beforeEach(() => {
    mockCallModel.mockReset();
});

/** 构造长消息链：1 条 system + N-1 条 user/assistant 交替（user 在偶数下标处） */
function buildLongMessages(count: number) {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: "system prompt" },
    ];

    for (let i = 1; i < count; i++) {
        messages.push({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `message ${i}`,
        });
    }

    return messages;
}

describe("上下文压缩", () => {
    it("消息超阈值时先请求摘要，再用压缩后的上下文跑主循环", async () => {
        // 70 条 > 阈值 60；recentStart = 70 - 24 = 46，其后第一条 user 在下标 46
        const messages = buildLongMessages(70);

        // 注意：runAgentStream 会向传入数组 push，这里对每次调用拍快照再断言
        const calls: Array<Array<{ role: string; content: string }>> = [];
        mockCallModel
            .mockImplementationOnce(async (msgs) => {
                calls.push([...msgs] as Array<{ role: string; content: string }>);
                return { content: "早期对话摘要：用户问了 A，读取了 B 文件。", tool_calls: [] };
            })
            .mockImplementationOnce(async (msgs) => {
                calls.push([...msgs] as Array<{ role: string; content: string }>);
                return { content: "最终答案。", tool_calls: [] };
            });

        const result = await runAgentStream(messages, () => {});

        expect(result.answer).toBe("最终答案。");
        expect(mockCallModel).toHaveBeenCalledTimes(2);

        // 第一次调用（摘要请求）：system 压缩指令 + user 转录
        expect(calls[0]).toHaveLength(2);
        expect(calls[0][0]?.content).toContain("compress");

        // 第二次调用（主循环）：system + 摘要 + 最近 24 条，而不是原始 70 条
        expect(calls[1]?.length).toBeLessThan(30);
        expect(calls[1]?.[1]?.content).toContain("[earlier conversation summary]");
        // 早期消息已被摘要替换（不再出现），最近的消息原样保留
        expect(calls[1]?.some((message) => message.content === "message 10")).toBe(false);
        expect(calls[1]?.some((message) => message.content === "message 69")).toBe(true);
    });

    it("消息未超阈值时不触发压缩", async () => {
        const messages = buildLongMessages(30);

        const calls: Array<Array<{ role: string }>> = [];
        mockCallModel.mockImplementationOnce(async (msgs) => {
            calls.push([...msgs] as Array<{ role: string }>);
            return { content: "答案。", tool_calls: [] };
        });

        await runAgentStream(messages, () => {});

        expect(mockCallModel).toHaveBeenCalledTimes(1);
        expect(calls[0]).toHaveLength(30);
    });

    it("摘要请求失败时静默降级，用原始消息链继续", async () => {
        const messages = buildLongMessages(70);

        const calls: Array<Array<{ role: string }>> = [];
        mockCallModel
            .mockImplementationOnce(async () => {
                throw new Error("summary failed");
            })
            .mockImplementationOnce(async (msgs) => {
                calls.push([...msgs] as Array<{ role: string }>);
                return { content: "降级后的答案。", tool_calls: [] };
            });

        const result = await runAgentStream(messages, () => {});

        expect(result.answer).toBe("降级后的答案。");
        // 主循环收到的是未压缩的 70 条
        expect(calls[0]).toHaveLength(70);
    });
});
