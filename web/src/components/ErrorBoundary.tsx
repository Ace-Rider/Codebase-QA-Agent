import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
    children: ReactNode;
};

type ErrorBoundaryState = {
    error: Error | null;
};

/**
 * 全局错误边界：渲染异常时不白屏，给出重试入口。
 * 不拦截事件处理器与异步代码里的错误（React 的固有限制）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[ErrorBoundary]", error, info.componentStack);
    }

    private handleReset = () => {
        this.setState({ error: null });
    };

    render() {
        if (!this.state.error) {
            return this.props.children;
        }

        return (
            <div className="error-boundary" role="alert">
                <div className="error-boundary-lamp" aria-hidden="true" />
                <h1>页面出了点问题</h1>
                <p className="error-boundary-message">{this.state.error.message || "渲染时发生未知错误"}</p>
                <div className="error-boundary-actions">
                    <button type="button" className="submit-btn" onClick={this.handleReset}>
                        重试
                    </button>
                    <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                            window.location.reload();
                        }}
                    >
                        刷新页面
                    </button>
                </div>
            </div>
        );
    }
}
