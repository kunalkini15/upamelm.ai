import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
          a: ({ children, href }) => <a className="text-accent underline underline-offset-2 hover:text-accent/80" href={href}>{children}</a>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-accent/40 pl-4 text-muted">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[0.9em] text-accent">{children}</code>,
          table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
          th: ({ children }) => <th className="border border-line bg-ink-950/70 px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-line px-3 py-2 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
