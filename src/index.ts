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

const app = express();
app.use(express.json());

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

app.get("/api/conversations", async (_req, res, next) => {
    try {
        const conversations = await listConversations();
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
        const messageText = error instanceof Error ? error.message : "internal server error";
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
