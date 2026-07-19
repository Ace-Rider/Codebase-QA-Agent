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

export type ChatResponse = {
    answer: string;
    steps: Step[];
    citations: Citation[];
    error: string | null;
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

export type StreamEvent =
    | { type: "status"; message: string }
    | { type: "answer_delta"; delta: string }
    | { type: "answer_reset" }
    | { type: "step"; step: Step }
    | { type: "final"; result: ChatResponse }
    | { type: "error"; error: string };
