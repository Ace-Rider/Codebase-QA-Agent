import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentStream, type StreamEvent } from "../src/agent/run-agent.js";
import { callModelWithToolsStream } from "../src/lib/model.js";
import { runTool } from "../src/agent/run-tool.js";

vi.mock("../src/lib/model.js", () => ({
    callModelWithToolsStream: vi.fn(),
}));

vi.mock("../src/agent/run-tool.js", () => ({
    runTool: vi.fn(),
}));

const mockCallModel = vi.mocked(callModelWithToolsStream);
const mockRunTool = vi.mocked(runTool);

function assistant(content: string, toolCalls: Array<{ id: string; name: string; args: string }> = []) {
    return {
        content,
        tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.args },
        })),
    };
}

beforeEach(() => {
    mockCallModel.mockReset();
    mockRunTool.mockReset();
});

describe("runAgentStream 工具循环", () => {
    it("模型请求工具 → 执行 → 回填 tool 消息 → 得到最终答案", async () => {
        const events: StreamEvent[] = [];
        const messages = [{ role: "user" as const, content: "src 里有哪些文件？" }];

        // 拍快照：runAgentStream 会向传入数组 push，直接断言 mock.calls 会拿到追加后的引用
        const calls: Array<Array<{ role: string; tool_call_id?: string; content: string }>> = [];

        mockCallModel
            .mockImplementationOnce(async (msgs) => {
                calls.push([...msgs] as Array<{ role: string; content: string }>);
                return assistant("", [{ id: "call_1", name: "list_files", args: '{"rootDir":"src"}' }]);
            })
            .mockImplementationOnce(async (msgs, handlers) => {
                calls.push([...msgs] as Array<{ role: string; content: string }>);
                await handlers?.onContentDelta?.("src 下有 agent、lib、tools 三个目录。");
                return assistant("src 下有 agent、lib、tools 三个目录。");
            });

        mockRunTool.mockResolvedValue({ files: [], total: 0, truncated: false });

        const result = await runAgentStream(messages, (event) => {
            events.push(event);
        });

        expect(result.answer).toContain("agent");
        expect(result.error).toBeNull();
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]?.tool_name).toBe("list_files");
        expect(result.steps[0]?.status).toBe("success");

        // 第二次调用应包含 tool 结果消息
        const toolMessage = calls[1]?.find((message) => message.role === "tool");

        expect(toolMessage).toBeDefined();
        expect(toolMessage?.tool_call_id).toBe("call_1");

        // 事件序列包含 step 与最终 answer_delta
        expect(events.some((event) => event.type === "step")).toBe(true);
        expect(events.some((event) => event.type === "answer_delta")).toBe(true);
    });

    it("工具抛错时不终止 run：错误作为 tool 消息回传给模型", async () => {
        const messages = [{ role: "user" as const, content: "读一个不存在的文件" }];
        const calls: Array<Array<{ role: string; content: string }>> = [];

        mockCallModel
            .mockImplementationOnce(async (msgs) => {
                calls.push([...msgs] as Array<{ role: string; content: string }>);
                return assistant("", [{ id: "call_err", name: "read_file", args: '{"filePath":"nope.ts"}' }]);
            })
            .mockImplementationOnce(async (msgs) => {
                calls.push([...msgs] as Array<{ role: string; content: string }>);
                return assistant("文件不存在，请确认路径。");
            });

        mockRunTool.mockRejectedValue(new Error("File not found: nope.ts"));

        const result = await runAgentStream(messages, () => {});

        expect(result.error).toBeNull();
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]?.status).toBe("error");
        expect(result.answer).toContain("文件不存在");

        const toolMessage = calls[1]?.find((message) => message.role === "tool");
        expect(toolMessage).toBeDefined();
        expect(toolMessage?.content).toContain("File not found");
    });

    it("达到最大迭代轮次时返回护栏消息", async () => {
        const messages = [{ role: "user" as const, content: "无限循环" }];

        // 每轮都要求调用工具，永不收敛
        mockCallModel.mockImplementation(async () =>
            assistant("", [{ id: "call_x", name: "list_files", args: "{}" }]),
        );
        mockRunTool.mockResolvedValue({ files: [] });

        const result = await runAgentStream(messages, () => {});

        expect(result.answer).toContain("最大迭代轮次");
        expect(mockCallModel).toHaveBeenCalledTimes(8);
    });

    it("token 用量跨迭代累计：prompt 取峰值、completion 求和", async () => {
        const messages = [{ role: "user" as const, content: "两轮调用" }];

        mockCallModel
            .mockResolvedValueOnce({
                ...assistant("", [{ id: "c1", name: "list_files", args: "{}" }]),
                usage: { prompt_tokens: 1000, completion_tokens: 50 },
            })
            .mockResolvedValueOnce({
                ...assistant("最终答案。"),
                usage: { prompt_tokens: 2500, completion_tokens: 30 },
            });

        mockRunTool.mockResolvedValue({ files: [] });

        const result = await runAgentStream(messages, () => {});

        expect(result.token_usage).toEqual({ prompt_tokens: 2500, completion_tokens: 80 });
    });

    it("信号中止时返回部分结果与停止说明", async () => {
        const controller = new AbortController();
        const messages = [{ role: "user" as const, content: "问点啥" }];

        mockCallModel.mockImplementation(async (_msgs, handlers) => {
            // 模拟流式输出到一半被中止：delta 已推送、请求以 aborted 结束
            await handlers?.onContentDelta?.("生成到一半的");
            controller.abort();
            return { content: "生成到一半的", tool_calls: [], aborted: true };
        });

        const result = await runAgentStream(
            messages,
            () => {},
            { signal: controller.signal },
        );

        expect(result.error).toContain("已手动停止");
        expect(result.answer).toBe("生成到一半的");
    });
});
