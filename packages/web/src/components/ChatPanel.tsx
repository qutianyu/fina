import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, BookOpen, Lightbulb, RotateCcw } from 'lucide-react';
import { useKbStore } from '../stores/kbStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Message { role: 'user' | 'assistant'; content: string; isStreaming?: boolean; }

const SUGGESTIONS = [
  { icon: BookOpen, label: '总结这篇文档的核心要点', color: 'text-blue-500' },
  { icon: Lightbulb, label: '帮我分析文档中的关键概念', color: 'text-amber-500' },
  { icon: Sparkles, label: '找到与当前主题相关的内容', color: 'text-violet-500' },
];

export function ChatPanel() {
  const { kbPath } = useKbStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { const ta = textareaRef.current; if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; } }, [input]);

  useEffect(() => {
    const handleStream = (data: { type: string; content: string }) => {
      if (data.type === 'text') {
        setMessages(prev => { const last = prev[prev.length - 1]; return last?.role === 'assistant' && last.isStreaming ? [...prev.slice(0, -1), { ...last, content: last.content + data.content }] : prev; });
      } else if (data.type === 'done') {
        setIsStreaming(false);
        setMessages(prev => { const last = prev[prev.length - 1]; return last?.role === 'assistant' ? [...prev.slice(0, -1), { ...last, isStreaming: false }] : prev; });
      }
    };
    window.electronAPI.onChatStream(handleStream);
    return () => window.electronAPI.removeChatStreamListener();
  }, []);

  const handleSend = async (query?: string) => {
    const content = query || input.trim();
    if (!content || !kbPath || isStreaming) return;
    setMessages(prev => [...prev, { role: 'user', content }, { role: 'assistant', content: '', isStreaming: true }]);
    if (!query) setInput('');
    setIsStreaming(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try { await window.electronAPI.chatQuery({ kbPath, query: content, abortSignal: Date.now().toString() }); }
    catch (e) { console.error('Chat error:', e); setIsStreaming(false); }
  };

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        {messages.length === 0 ? (
          <div className="h-full min-h-[60vh] flex items-center justify-center px-6">
            <div className="text-center max-w-md animate-fadeIn">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20"><Bot className="w-8 h-8 text-white" /></div>
              <h2 className="text-xl font-semibold mb-2">AI 知识助手</h2>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">基于你的知识库内容回答问题、总结文档、探索概念间的联系</p>
              <div className="space-y-2.5">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => handleSend(s.label)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:bg-secondary/60 transition-colors text-left group">
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0"><s.icon className={`w-4 h-4 ${s.color}`} /></div>
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fadeIn`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                  {msg.isStreaming && !msg.content ? (
                    <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
                  ) : <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>}
                  {msg.isStreaming && msg.content && <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse ml-0.5 align-text-bottom" />}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div className="border-t bg-card p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 items-end">
            <Textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="输入你的问题..." className="flex-1 min-h-[44px] max-h-[120px] resize-none" disabled={isStreaming} rows={1} />
            <Button size="icon" className="h-10 w-10 rounded-xl flex-shrink-0 shadow-sm" onClick={() => handleSend()} disabled={!input.trim() || isStreaming}><Send className="w-4 h-4" /></Button>
            {messages.length > 0 && <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl flex-shrink-0" onClick={() => { if (!isStreaming) setMessages([]); }} disabled={isStreaming}><RotateCcw className="w-4 h-4" /></Button>}
          </div>
          <p className="text-[11px] text-muted-foreground/50 mt-2 text-center">Enter 发送 · Shift+Enter 换行</p>
        </div>
      </div>
    </div>
  );
}