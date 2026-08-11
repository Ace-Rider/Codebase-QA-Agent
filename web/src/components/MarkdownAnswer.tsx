import {
    Fragment,
    cloneElement,
    isValidElement,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github-dark.css";

// 只注册问答场景高频出现的语言，替代 rehype-highlight 默认的 common 全集（约 35 种）
const HIGHLIGHT_LANGUAGES = {
    typescript,
    javascript,
    json,
    bash,
    xml,
    css,
    markdown,
    yaml,
    sql,
    python,
    java,
    go,
    rust,
};

const HIGHLIGHT_ALIASES = {
    typescript: ["ts", "tsx"],
    javascript: ["js", "jsx", "mjs", "cjs"],
    bash: ["sh", "shell", "zsh"],
    xml: ["html", "svg"],
    markdown: ["md"],
    yaml: ["yml"],
    python: ["py"],
    rust: ["rs"],
};

function getLanguage(children: ReactNode) {
    const child = Array.isArray(children) ? children[0] : children;

    if (child && typeof child === "object" && "props" in child) {
        const className = (child.props as { className?: string } | undefined)?.className;
        const match = /language-([\w+-]+)/.exec(className ?? "");
        return match?.[1] ?? "code";
    }

    return "code";
}

function CodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
    const preRef = useRef<HTMLPreElement>(null);
    const [copied, setCopied] = useState(false);
    const language = getLanguage(children);

    async function handleCopy() {
        const text = preRef.current?.innerText ?? "";

        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // 剪贴板不可用时静默忽略
        }
    }

    return (
        <div className="code-block">
            <div className="code-block-bar">
                <span className="code-block-lang">{language}</span>
                <button className="code-block-copy" type="button" onClick={handleCopy}>
                    {copied ? "已复制" : "复制"}
                </button>
            </div>
            <pre ref={preRef}>{children}</pre>
        </div>
    );
}

const FOOTNOTE_PATTERN = /(\[\d{1,2}\])/g;

/**
 * 把文本里的 [1] [2] 引用标记变成可点击脚注。
 * 代码与链接内的方括号保持原样。
 */
function withFootnotes(children: ReactNode, onCitationRef?: (index: number) => void): ReactNode {
    if (!onCitationRef) {
        return children;
    }

    const visit = (node: ReactNode): ReactNode => {
        if (typeof node === "string") {
            const parts = node.split(FOOTNOTE_PATTERN);

            if (parts.length === 1) {
                return node;
            }

            return parts.map((part, index) => {
                const match = /^\[(\d{1,2})\]$/.exec(part);

                if (!match) {
                    return part;
                }

                const footnoteIndex = Number(match[1]);

                return (
                    <sup key={index}>
                        <button
                            className="fn-ref"
                            type="button"
                            aria-label={`跳到依据出处 ${footnoteIndex}`}
                            onClick={() => onCitationRef(footnoteIndex)}
                        >
                            [{footnoteIndex}]
                        </button>
                    </sup>
                );
            });
        }

        if (Array.isArray(node)) {
            return node.map((child, index) => <Fragment key={index}>{visit(child)}</Fragment>);
        }

        if (isValidElement(node)) {
            // code 里的 [0] 是数组下标，链接文本已由 markdown 解析，都不转换
            if (node.type === "code" || node.type === "a") {
                return node;
            }

            const child = node.props as { children?: ReactNode };

            if (child.children != null) {
                return cloneElement(node, undefined, visit(child.children));
            }
        }

        return node;
    };

    return visit(children);
}

type MarkdownAnswerProps = {
    content: string;
    onCitationRef?: (index: number) => void;
};

export function MarkdownAnswer({ content, onCitationRef }: MarkdownAnswerProps) {
    return (
        <div className="markdown-body answer-markdown">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[
                    [rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES, aliases: HIGHLIGHT_ALIASES }],
                ]}
                components={{
                    pre: CodeBlock,
                    p: ({ children }) => <p>{withFootnotes(children, onCitationRef)}</p>,
                    li: ({ children }) => <li>{withFootnotes(children, onCitationRef)}</li>,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
