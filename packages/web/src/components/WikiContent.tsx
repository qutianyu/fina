import { useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';

interface WikiContentProps {
  content: string;
  onNavigate: (path: string) => void;
}

// 双链正则：匹配 [[link]] 或 [[link|text]]
const WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// 将双链转换为 Markdown 链接格式
function preprocessWikiLinks(content: string): string {
  return content.replace(WIKI_LINK_REGEX, (match, link, text) => {
    const displayText = text || link;
    // 将空格替换为 -，与 make.ts 中的 slugify 保持一致
    const slugifiedLink = link.toLowerCase().replace(/\s+/g, '-');
    return `[${displayText}](wiki:${slugifiedLink})`;
  });
}

// 自定义链接组件
function WikiLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (href?.startsWith('wiki:')) {
      const target = href.replace('wiki:', '');
      // 触发导航事件
      window.dispatchEvent(new CustomEvent('wiki-navigate', { detail: target }));
    } else if (href) {
      // 外部链接，在新窗口打开
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, [href]);

  if (href?.startsWith('wiki:')) {
    return (
      <a
        href={href}
        onClick={handleClick}
        className="text-primary hover:underline cursor-pointer font-medium"
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className="text-primary hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

// 自定义图片组件
function WikiImage({ src, alt }: { src?: string; alt?: string }) {
  // 处理相对路径图片
  let imageSrc = src;
  if (src && !src.startsWith('http') && !src.startsWith('data:')) {
    // 相对路径，通过 IPC 获取
    imageSrc = `electron-image://${src}`;
  }

  return (
    <img
      src={imageSrc}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg my-4"
      loading="lazy"
    />
  );
}

export function WikiContent({ content, onNavigate }: WikiContentProps) {
  // 监听导航事件
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const target = (e as CustomEvent<string>).detail;
      onNavigate(target);
    };

    window.addEventListener('wiki-navigate', handleNavigate);
    return () => window.removeEventListener('wiki-navigate', handleNavigate);
  }, [onNavigate]);

  const processedContent = preprocessWikiLinks(content);

  return (
    <div className="wiki-content prose prose-slate dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeSanitize]}
        components={{
          a: ({ href, children }) => <WikiLink href={href}>{children}</WikiLink>,
          img: ({ src, alt }) => <WikiImage src={src} alt={alt} />,
          // 自定义代码块
          pre: ({ children }) => (
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto my-4">
              {children}
            </pre>
          ),
          code: ({ className, children }) => {
            const isInline = !className;
            return isInline ? (
              <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                {children}
              </code>
            ) : (
              <code className={className}>{children}</code>
            );
          },
          // 表格样式
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="w-full border-collapse border border-border">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-4 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-4 py-2">{children}</td>
          ),
          // 引用块
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground">
              {children}
            </blockquote>
          ),
          // 列表
          ul: ({ children }) => <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>,
          // 标题
          h1: ({ children }) => <h1 className="text-3xl font-bold mt-8 mb-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-2xl font-semibold mt-6 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xl font-semibold mt-4 mb-2">{children}</h3>,
          h4: ({ children }) => <h4 className="text-lg font-semibold mt-3 mb-2">{children}</h4>,
          // 段落
          p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
          // 水平线
          hr: () => <hr className="my-6 border-border" />,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
