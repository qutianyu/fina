import {
  ChevronRight, FileText, Folder, FolderOpen, Search, Plus, RefreshCw, BookOpen,
  MessageSquare, Settings, FileCode2, FileJson2, Image as ImageIcon, File, Hash,
  PanelLeftClose, PanelLeft
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useKbStore } from '../stores/kbStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface FileTreeNode {
  name: string; path: string; isDir: boolean; children?: FileTreeNode[];
  fileType?: 'markdown' | 'image' | 'json' | 'code' | 'other';
}

interface SidebarProps {
  onSelectFile: (path: string) => void; selectedPath: string | null;
  onOpenChat: () => void; onOpenSettings: () => void;
  width: number; onWidthChange: (width: number) => void;
  collapsed: boolean; onToggleCollapse: () => void;
}

function getFileIcon(node: FileTreeNode) {
  if (node.isDir) return null;
  switch (node.fileType) {
    case 'markdown': return <FileText className="w-3.5 h-3.5 text-blue-500" />;
    case 'code': return <FileCode2 className="w-3.5 h-3.5 text-violet-500" />;
    case 'json': return <FileJson2 className="w-3.5 h-3.5 text-amber-500" />;
    case 'image': return <ImageIcon className="w-3.5 h-3.5 text-emerald-500" />;
    default: return <File className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function TreeNode({ node, level = 0, onSelect, selectedPath }: {
  node: FileTreeNode; level?: number; onSelect: (path: string) => void; selectedPath: string | null;
}) {
  const [isOpen, setIsOpen] = useState(level < 1);
  const isSelected = selectedPath === node.path;
  return (
    <div>
      <div onClick={() => node.isDir ? setIsOpen(!isOpen) : onSelect(node.path)}
        className={`tree-item ${isSelected ? 'active' : ''} ${node.isDir && isOpen ? 'expanded' : ''}`}
        style={{ paddingLeft: `${8 + level * 16}px` }}>
        {node.isDir && <ChevronRight className="toggle-icon" />}
        <span className="flex-shrink-0">
          {node.isDir ? (isOpen ? <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> : <Folder className="w-3.5 h-3.5 text-amber-400" />) : getFileIcon(node)}
        </span>
        <span className="truncate flex-1">{node.name}</span>
      </div>
      {node.isDir && isOpen && node.children?.map(child => (
        <TreeNode key={child.path} node={child} level={level + 1} onSelect={onSelect} selectedPath={selectedPath} />
      ))}
    </div>
  );
}

export function Sidebar({ onSelectFile, selectedPath, onOpenChat, onOpenSettings, width, onWidthChange, collapsed, onToggleCollapse }: SidebarProps) {
  const { kbPath } = useKbStore();
  const [roots, setRoots] = useState<FileTreeNode[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);

  const loadTree = useCallback(async () => {
    if (!kbPath) return;
    setIsLoading(true);
    try { const r = await window.electronAPI.wikiTree(kbPath); if (r.success && r.roots) setRoots(r.roots); }
    catch (e) { console.error('Failed to load tree:', e); }
    finally { setIsLoading(false); }
  }, [kbPath]);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      onWidthChange(Math.max(220, Math.min(400, e.clientX)));
    };
    const onUp = () => {
      isResizing.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [onWidthChange]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const kbName = kbPath ? kbPath.split('/').pop() : '未选择';
  const filterTree = (node: FileTreeNode, q: string): FileTreeNode | null => {
    const m = node.name.toLowerCase().includes(q.toLowerCase());
    if (node.isDir && node.children) {
      const f = node.children.map(c => filterTree(c, q)).filter(Boolean) as FileTreeNode[];
      if (m || f.length > 0) return { ...node, children: f };
    }
    return m ? node : null;
  };
  const filteredRoots = searchQuery ? roots.map(r => filterTree(r, searchQuery)).filter(Boolean) as FileTreeNode[] : roots;

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={300}>
        <aside className="w-12 h-full flex-shrink-0 flex flex-col bg-card items-center py-3 gap-1 border-r">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleCollapse}><PanelLeft className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent side="right">展开侧栏</TooltipContent></Tooltip>
          <Separator className="my-2 w-6" />
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center"><BookOpen className="w-3.5 h-3.5 text-white" /></div>
          <div className="flex-1" />
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenChat}><MessageSquare className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent side="right">AI 对话</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenSettings}><Settings className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent side="right">设置</TooltipContent></Tooltip>
        </aside>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      {/* Overlay to prevent iframe/text selection during drag */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}

      <aside className="h-full flex-shrink-0 flex flex-col bg-card border-r" style={{ width: `${width}px` }}>
        {/* Header */}
        <div className="h-[52px] flex items-center px-3 gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm"><BookOpen className="w-4.5 h-4.5 text-white" /></div>
          <span className="font-semibold text-sm truncate flex-1">{kbName}</span>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadTree}><RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /></Button></TooltipTrigger><TooltipContent>刷新</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleCollapse}><PanelLeftClose className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent>收起侧栏</TooltipContent></Tooltip>
        </div>

        <Separator />

        {/* Search */}
        <div className="px-3 py-2.5 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索文档..." className="search-input pl-8 h-8 text-[13px]" />
          </div>
        </div>

        {/* Actions */}
        <div className="px-3 pb-2 flex gap-1 flex-shrink-0">
          <Button variant="secondary" size="sm" className="flex-1 text-[12px] gap-1.5 h-7" onClick={onOpenChat}><MessageSquare className="w-3.5 h-3.5" /> AI 对话</Button>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadTree}><Plus className="w-3.5 h-3.5" /></Button></TooltipTrigger><TooltipContent>添加内容</TooltipContent></Tooltip>
        </div>

        <div className="section-header flex-shrink-0"><Hash className="w-3 h-3 inline mr-1" />文档</div>

        {/* Tree */}
        <ScrollArea className="flex-1">
          <div className="py-0.5">
            {isLoading ? (
              <div className="px-4 py-8 space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shimmer" /><div className="flex-1 h-3 rounded shimmer" /></div>)}
              </div>
            ) : filteredRoots.length === 0 ? (
              <div className="text-center py-12 px-4">
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">{searchQuery ? '未找到匹配的文档' : '暂无文档'}</p>
                {!searchQuery && <p className="text-xs text-muted-foreground/50 mt-1">运行 fina make 生成知识库</p>}
              </div>
            ) : filteredRoots.map(root => <TreeNode key={root.path} node={root} onSelect={onSelectFile} selectedPath={selectedPath} />)}
          </div>
        </ScrollArea>

        <Separator />
        <div className="px-3 py-2 flex-shrink-0">
          <p className="text-[11px] text-muted-foreground/50 text-center">{roots.reduce((a, n) => a + countFiles(n), 0)} 篇文档</p>
        </div>
      </aside>

      {/* Resize handle */}
      <div
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
        onMouseDown={startResize}
      />
    </TooltipProvider>
  );
}

function countFiles(node: FileTreeNode): number { return node.isDir ? (node.children || []).reduce((a, c) => a + countFiles(c), 0) : 1; }