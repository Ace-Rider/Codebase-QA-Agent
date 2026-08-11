export type Step = {
    iteration: number;
    status: "success" | "error";
    duration_ms: number;
    tool_name: string;
    tool_args: unknown;
    tool_result: unknown;
    tool_label?: string;
    status_label?: string;
    duration_text?: string;
    tool_args_text?: string;
    tool_result_text?: string;
    tool_result_full_text?: string;
    expandable?: boolean;
};

export type Citation = {
    file_path: string;
    source: "read_file" | "grep_files";
    line_number?: number;
    excerpt?: string;
    reason?: string;
};

export type TokenUsageSummary = {
    /** 最后一轮请求的上下文规模（prompt tokens） */
    prompt_tokens: number;
    /** 本轮全部生成消耗（completion tokens，跨迭代累计） */
    completion_tokens: number;
};

export type ChatResponse = {
    answer: string;
    steps: Step[];
    citations: Citation[];
    error: string | null;
    token_usage?: TokenUsageSummary | null;
};

/** 对话中的一次问答轮次（用户提问 + Agent 回答） */
export type ChatTurn = {
    id: string;
    question: string;
    answer: string;
    steps: Step[];
    citations: Citation[];
    error: string | null;
    token_usage?: TokenUsageSummary | null;
    createdAt?: string;
    isStreaming?: boolean;
};

export type ConversationHistoryItem = {
    id: string;
    title: string;
    message: string;
    answer: string;
    steps: Step[];
    citations: Citation[];
    error: string | null;
    createdAt?: string;
    updatedAt: string;
    isPending?: boolean;
};

export type ConversationDetail = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turns: ChatTurn[];
};

export type FilePreview = {
    path: string;
    content: string;
};

export type StreamEvent =
    | { type: "status"; message: string }
    | { type: "answer_delta"; delta: string }
    | { type: "answer_reset" }
    | { type: "step"; step: Step }
    | { type: "final"; result: ChatResponse }
    | { type: "error"; error: string };
