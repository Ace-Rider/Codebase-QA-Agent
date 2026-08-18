import { afterEach, describe, expect, it, vi } from "vitest";

// model.ts 在模块加载时读取环境变量，但测试中 fetch 全程被 mock，不会发出真实请求
import { callModelWithToolsStream } from "../src/lib/model.js";

function sseResponse(lines: string[], init?: ResponseInit) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const line of lines) {
                controller.enqueue(encoder.encode(line));
            }
            controller.close();
        },
    });

    return new Response(stream, { status: 200, ...init });
}

function dataLine(payload: string) {
    return `data: ${payload}\n\n`;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("callModelWithToolsStream", () => {
    it("拼接内容增量并在 [DONE] 处结束", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                sseResponse([
                    dataLine(JSON.stringify({ choices: [{ delta: { content: "你好" } }] })),
                    dataLine(JSON.stringify({ choices: [{ delta: { content: "，世界" } }] })),
                    // 无关行（注释/心跳）应被忽略
                    ": keep-alive\n\n",
                    "data: [DONE]\n\n",
                ]),
            ),
        );

        const deltas: string[] = [];
        const result = await callModelWithToolsStream([{ role: "user", content: "hi" }], {
            onContentDelta: (delta) => {
                deltas.push(delta);
            },
        });

        expect(result.content).toBe("你好，世界");
        expect(deltas).toEqual(["你好", "，世界"]);
        expect(result.tool_calls).toEqual([]);
        expect(result.aborted).toBeUndefined();
    });

    it("跨分片合并 tool_calls 的 id / name / arguments", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                sseResponse([
                    dataLine(
                        JSON.stringify({
                            choices: [
                                {
                                    delta: {
                                        tool_calls: [
                                            {
                                                index: 0,
                                                id: "call_1",
                                                type: "function",
                                                function: { name: "read_f", arguments: '{"filePa' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        }),
                    ),
                    dataLine(
                        JSON.stringify({
                            choices: [
                                {
                                    delta: {
                                        tool_calls: [
                                            {
                                                index: 0,
                                                function: { name: "ile", arguments: 'th":"src/a.ts"}' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        }),
                    ),
                    "data: [DONE]\n\n",
                ]),
            ),
        );

        const result = await callModelWithToolsStream([{ role: "user", content: "read" }]);

        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls[0]?.id).toBe("call_1");
        expect(result.tool_calls[0]?.function.name).toBe("read_file");
        expect(JSON.parse(result.tool_calls[0]?.function.arguments ?? "")).toEqual({ filePath: "src/a.ts" });
    });

    it("解析流末尾的 usage 统计", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                sseResponse([
                    dataLine(JSON.stringify({ choices: [{ delta: { content: "ok" } }] })),
                    dataLine(JSON.stringify({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 34 } })),
                    "data: [DONE]\n\n",
                ]),
            ),
        );

        const result = await callModelWithToolsStream([{ role: "user", content: "hi" }]);

        expect(result.usage).toEqual({ prompt_tokens: 1200, completion_tokens: 34 });
    });

    it("坏 JSON 分片不导致整体失败", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                sseResponse([
                    dataLine("{not json"),
                    dataLine(JSON.stringify({ choices: [{ delta: { content: "答案" } }] })),
                    "data: [DONE]\n\n",
                ]),
            ),
        );

        const result = await callModelWithToolsStream([{ role: "user", content: "hi" }]);

        expect(result.content).toBe("答案");
    });

    it("网络层拒绝且信号已中止时返回 aborted 结果", async () => {
        const controller = new AbortController();
        controller.abort();

        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("network down");
            }),
        );

        const result = await callModelWithToolsStream(
            [{ role: "user", content: "hi" }],
            {},
            controller.signal,
        );

        expect(result.aborted).toBe(true);
        expect(result.content).toBe("");
    });
});
