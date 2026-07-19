# Codebase QA Agent

一个面向本地代码仓库的智能问答 Agent。

用户在前端输入自然语言问题后，系统会结合大模型与本地代码检索工具，对当前项目进行多轮分析，并将答案生成过程、工具调用轨迹、引用文件和最终结果实时展示在页面中。

这个项目不是“聊天框 + 模型接口”的简单拼接，而是一个包含工具调用、流式输出、会话持久化和可视化执行轨迹的完整 Agent Demo。

## 项目特点

- 支持围绕本地代码仓库进行自然语言问答
- 支持模型自主决定是否调用工具
- 支持多轮 Agent 推理与工具调用循环
- 支持答案内容逐段流式输出
- 支持工具执行状态、参数、结果的可视化展示
- 支持引用文件追踪，增强回答可解释性
- 支持基于会话的连续追问
- 支持历史会话持久化与回看

## 核心能力

当前项目内置了 4 个本地工具：

- `list_files`：列出目录下的文件结构
- `grep_files`：搜索目录中的关键词匹配结果
- `read_file`：读取单个文本文件内容
- `read_multiple_files`：一次读取多个文件，便于横向对比分析

Agent 会根据用户问题决定是否需要先调用工具。当模型返回 `tool_calls` 后，后端执行工具，将结果回填到消息上下文中，再继续发起下一轮模型请求，直到模型具备足够信息输出最终回答。

## 项目架构

### 后端

- `Express` 提供接口与 SSE 流式输出能力
- `OpenAI-compatible Chat Completions API` 负责模型推理与工具调用
- `Prisma + SQLite` 负责会话与消息持久化
- `fast-glob` 和文件系统工具负责本地代码检索

### 前端

- `React + TypeScript` 构建交互界面
- `Vite` 作为前端开发与构建工具
- `react-markdown + remark-gfm` 渲染 Markdown 格式答案

## 工作流程

1. 用户在前端输入问题。
2. 前端调用 `POST /api/chat/stream`，携带 `message` 和 `sessionId`。
3. 后端将本轮用户问题追加到当前会话消息中。
4. 后端调用模型流式接口，并持续接收 `content` 与 `tool_calls` 增量。
5. 若模型需要工具：
   - 后端执行对应工具
   - 将工具结果写回会话消息
   - 向前端推送工具步骤和状态事件
   - 继续进入下一轮模型调用
6. 若模型已具备足够信息：
   - 后端整理最终结果
   - 返回标准化的 `answer / steps / citations / error`
   - 将结果持久化到本地数据库
7. 前端基于 SSE 逐步渲染答案、步骤和最终结果。

## 流式事件设计

后端不会把原始模型协议直接暴露给前端，而是转换成更稳定的 UI 事件流：

```ts
type StreamEvent =
  | { type: "status"; message: string }
  | { type: "answer_delta"; delta: string }
  | { type: "answer_reset" }
  | { type: "step"; step: Step }
  | { type: "final"; result: ChatResponse }
  | { type: "error"; error: string };
```

其中：

- `answer_delta` 用于前端逐段拼接答案，实现“边生成边显示”
- `answer_reset` 用于模型先输出解释、后决定调用工具时清空临时内容
- `step` 用于展示工具调用轨迹
- `final` 用于统一落库和渲染最终结果

## 返回结果结构

```ts
type ChatResponse = {
  answer: string;
  steps: Step[];
  citations: Citation[];
  error: string | null;
};
```

这种标准化结构可以让前端不必关心底层模型协议细节，只聚焦于渲染答案、证据和执行过程。

## 会话与数据持久化

项目已接入 `Prisma + SQLite`，本地会话并非只保存在内存中。

当前会持久化的数据包括：

- 会话标题
- 用户最新提问
- 最终答案
- 工具执行步骤
- 引用信息
- 完整消息链路

这使得项目具备以下能力：

- 刷新页面后仍可查看历史会话
- 支持按会话回看之前的问题与答案
- 支持在已有上下文基础上继续追问

## 前端展示内容

前端页面主要包含 4 个区域：

- 提问输入区：提交问题、显示当前会话状态
- Answer 区：逐段渲染模型输出的最终回答
- Citations 区：展示引用到的文件与证据
- Steps 区：展示每一步工具调用的参数、结果与耗时

其中 `Answer` 区的流式效果来自前端持续接收 `answer_delta` 事件，并将新内容追加到本地 `liveAnswerBuffer` 后再更新状态渲染。

## 技术栈

- Node.js
- TypeScript
- Express
- OpenAI SDK
- React
- Vite
- Prisma
- SQLite
- fast-glob
- SSE

## 项目结构

```txt
src/
  index.ts                  # Express 服务入口
  lib/
    model.ts                # 模型流式调用与 tool_calls 合并
    prisma.ts               # Prisma 客户端
  agent/
    run-agent.ts            # 多轮 Agent 调度主流程
    run-tool.ts             # 工具执行分发
    session-store.ts        # 会话持久化与历史读取
  tools/
    list-files.ts           # 列出文件
    grep-files.ts           # 关键词检索
    read-file.ts            # 读取文件
    workspace.ts            # 工作目录处理
    normalizeResult.ts      # 结果标准化

prisma/
  schema.prisma             # 数据库模型

web/
  src/
    App.tsx
    hooks/useChatStream.ts  # 前端流式消费逻辑
    services/chat.ts        # SSE 请求封装
    components/             # 答案、步骤、历史侧边栏等组件
```

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
AI_API_KEY=your_api_key
AI_BASE_URL=https://your-compatible-openai-base-url/v1
AI_MODEL=your_model_name
DATABASE_URL="file:./prisma/dev.db"
```

### 3. 启动开发环境

```bash
npm run dev
```

默认会同时启动：

- 后端服务：`http://localhost:3001`
- 前端开发服务：`http://localhost:5173`

### 4. 类型检查

```bash
npm run typecheck
```

### 5. 构建项目

```bash
npm run build
```

### 6. 启动生产构建

```bash
npm start
```

启动后可访问：

```txt
http://localhost:3001
```

## 可尝试的问题

- 请梳理一下 `src` 目录的整体结构
- 解释 `src/agent/run-agent.ts` 的多轮循环逻辑
- 搜索 `tool_choice` 的使用位置并说明作用
- 结合 `src/index.ts`、`src/lib/model.ts`、`web/src/hooks/useChatStream.ts` 说明流式输出是怎么实现的
- 说明 Answer 区为什么能够保持前后内容连续
- 查看历史会话的持久化逻辑在哪
