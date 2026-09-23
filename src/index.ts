import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import {
    createSessionTurn,
    deleteConversation,
    getConversationDetail,
    listConversations,
    renameConversation,
    saveSessionTurn,
    type SessionTurnContext,
} from "./agent/session-store.js";
import { runAgentStream, type ChatResponse, type StreamEvent } from "./agent/run-agent.js";
import { readFileContent } from "./tools/read-file.js";
import { getProjectRoot } from "./tools/workspace.js";

const app = express();
app.use(express.json());

/**
 * 把底层报错翻译成用户能看懂、知道下一步做什么的提示。
 * 未匹配的错误保留原始信息（对开发者排查仍有价值）。
 */
function toUserFriendlyError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);

    if (/abort/i.test(raw)) {
        return "已手动停止";
    }

    if (/\b403\b|invalid_api_key|unauthorized/i.test(raw)) {
        return "API Key 无效或已过期，请检查 .env 中的 AI_API_KEY";
    }

    if (/\b401\b/.test(raw)) {
        return "鉴权失败，请检查 .env 中的 AI_API_KEY";
    }

    if (/\b429\b|rate.?limit/i.test(raw)) {
        return "请求过于频繁或额度不足，请稍后再试";
    }

    if (/\b404\b|not found.*model|invalid.*model/i.test(raw)) {
        return "模型不存在，请检查 .env 中的 AI_MODEL";
    }

    if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|ENOTFOUND/i.test(raw)) {
        return "网络连接失败，请检查网络或 AI_BASE_URL 配置";
    }

    if (/AI_API_KEY is missing|AI_BASE_URL is missing|AI_MODEL is missing/.test(raw)) {
        return `${raw}，请在项目根目录配置 .env 文件（参考 .env.example）`;
    }

    return raw;
}

const webDistDir = path.resolve("web/dist");
const hasWebDist = existsSync(webDistDir);

type ChatRequestBody = {
    message?: unknown;
    sessionId?: unknown;
};

if (hasWebDist) {
    app.use(express.static(webDistDir));
}

app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
});

// 当前工作区信息：前端顶栏展示，让用户知道 Agent 正在读哪个目录
app.get("/api/workspace", (_req, res) => {
    res.json({
        root: getProjectRoot(),
        name: path.basename(getProjectRoot()),
        isExternal: process.env.WORKSPACE_ROOT !== undefined,
    });
});

app.get("/api/conversations", async (req, res, next) => {
    try {
        // 支持前端按需拉取更多历史（配合抽屉内搜索），上限 200 条防止响应过大
        const requested = Number.parseInt(String(req.query.limit ?? ""), 10);
        const limit =
            Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : 50;
        const conversations = await listConversations(limit);
        res.json(conversations);
    } catch (error) {
        next(error);
    }
});

app.get("/api/conversations/:id", async (req, res, next) => {
    try {
        const conversation = await getConversationDetail(String(req.params.id));

        if (!conversation) {
            res.status(404).json({ error: "conversation not found" });
            return;
        }

        res.json(conversation);
    } catch (error) {
        next(error);
    }
});

app.delete("/api/conversations/:id", async (req, res, next) => {
    try {
        const deleted = await deleteConversation(String(req.params.id));

        if (!deleted) {
            res.status(404).json({ error: "conversation not found" });
            return;
        }

        res.json({ ok: true });
    } catch (error) {
        next(error);
    }
});

app.patch("/api/conversations/:id", async (req, res, next) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";

    if (!title) {
        res.status(400).json({ error: "title is required" });
        return;
    }

    try {
        const item = await renameConversation(String(req.params.id), title);
        res.json(item);
    } catch (error) {
        next(error);
    }
});

app.get("/api/files", async (req, res) => {
    const filePath = typeof req.query.path === "string" ? req.query.path.trim() : "";

    if (!filePath) {
        res.status(400).json({ error: "path is required" });
        return;
    }

    try {
        const content = await readFileContent(filePath);
        res.json({ path: filePath, content });
    } catch (error) {
        const message = error instanceof Error ? error.message : "failed to read file";
        res.status(404).json({ error: message });
    }
});

function createChatErrorResponse(error: string): ChatResponse {
    return {
        answer: "",
        steps: [],
        citations: [],
        error,
    };
}

function getChatRequestPayload(body: ChatRequestBody) {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    return { message, sessionId };
}

app.post("/api/chat/stream", async (req, res) => {
    const { message, sessionId } = getChatRequestPayload(req.body as ChatRequestBody);

    if (!message || !sessionId) {
        res.status(400).json(createChatErrorResponse("message and sessionId are required"));
        return;
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });
    res.flushHeaders?.();

    const writeEvent = (event: StreamEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 客户端提前断开（关闭页面/点击停止）时中止 Agent，避免继续消耗模型请求
    const abortController = new AbortController();

    res.on("close", () => {
        if (!res.writableEnded) {
            abortController.abort();
        }
    });

    let turnContext: SessionTurnContext | null = null;
    let messages = [] as Awaited<ReturnType<typeof createSessionTurn>>["messages"];

    try {
        turnContext = await createSessionTurn(sessionId, message);
        messages = turnContext.messages;
        const result = await runAgentStream(messages, writeEvent, { signal: abortController.signal });
        await saveSessionTurn(sessionId, message, turnContext, result);
        writeEvent({ type: "final", result });
        res.write("data: [DONE]\n\n");
    } catch (error) {
        const messageText = toUserFriendlyError(error);
        const result = createChatErrorResponse(messageText);

        if (sessionId && message && turnContext) {
            try {
                await saveSessionTurn(sessionId, message, turnContext, result);
            } catch (saveError) {
                console.error(saveError);
            }
        }

        writeEvent({ type: "error", error: messageText });
        writeEvent({ type: "final", result });
        res.write("data: [DONE]\n\n");
    } finally {
        res.end();
    }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);

    res.status(500).json(
        createChatErrorResponse(error instanceof Error ? error.message : "internal server error"),
    );
});

if (hasWebDist) {
    app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(path.join(webDistDir, "index.html"));
    });
}

const port = 3001;
app.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
});
