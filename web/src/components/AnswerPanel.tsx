import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AnswerPanelProps = {
    answer: string;
    isLoading: boolean;
};

export function AnswerPanel({ answer, isLoading }: AnswerPanelProps) {
    return (
        <section className="panel answer-panel">
            <div className="panel-header panel-header-tight">
                <div>
                    <div className="panel-kicker">Answer</div>
                    <h2>回答</h2>
                </div>
                <div className="panel-side-note">
                    {isLoading ? "正在流式生成回答" : answer ? "已生成最终回答" : "等待输入问题"}
                </div>
            </div>

            <div className="answer-box markdown-body">
                {answer ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
                ) : (
                    <div className="empty-state empty-state-large">
                        {isLoading ? "正在等待回答..." : "暂时还没有结果。"}
                    </div>
                )}
            </div>
        </section>
    );
}
