import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { WikiContent } from './components/WikiContent';
import { ChatPanel } from './components/ChatPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { useKbStore } from './stores/kbStore';
import { Sparkles, FolderOpen, Loader2, BookOpen, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ViewType = 'doc' | 'chat' | 'settings';

function App() {
  const { kbPath, loadKbPath } = useKbStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<ViewType>('doc');
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => { loadKbPath(); }, [loadKbPath]);

  const handleSelectFile = async (path: string) => {
    if (!kbPath) return;
    setSelectedFile(path);
    setCurrentView('doc');
    const result = await window.electronAPI.wikiFile(kbPath, path);
    if (result.success) {
      setFileContent(result.content || '');
      setBreadcrumbs(path.split('/'));
    }
  };

  if (!kbPath) return <SetupScreen onSelect={loadKbPath} />;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          onSelectFile={handleSelectFile}
          selectedPath={selectedFile}
          onOpenChat={() => setCurrentView('chat')}
          onOpenSettings={() => setCurrentView('settings')}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div className="flex-1 flex flex-col min-w-0 border-l border-border">
          <Header
            breadcrumbs={breadcrumbs}
            onNavigateHome={() => { setSelectedFile(null); setBreadcrumbs([]); setFileContent(''); }}
            onOpenSettings={() => setCurrentView('settings')}
            currentView={currentView}
            onSwitchView={setCurrentView}
          />
          <main className="flex-1 overflow-hidden">
            {currentView === 'doc' && <DocView selectedFile={selectedFile} content={fileContent} />}
            {currentView === 'chat' && <ChatPanel />}
            {currentView === 'settings' && <SettingsPanel />}
          </main>
        </div>
      </div>
    </div>
  );
}

function DocView({ selectedFile, content }: { selectedFile: string | null; content: string }) {
  if (!selectedFile) {
    return (
      <div className="h-full flex items-center justify-center bg-background/50">
        <div className="text-center max-w-sm mx-auto animate-fadeIn">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-muted flex items-center justify-center">
            <FileText className="w-10 h-10 text-muted-foreground/60" strokeWidth={1.2} />
          </div>
          <h3 className="text-xl font-semibold mb-3">欢迎使用 Fina</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            从左侧选择文档开始阅读<br />或切换到 AI 对话开始提问
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl py-12 px-6 md:px-12">
        <article className="doc-content">
          <WikiContent content={content} onNavigate={(target) => console.log('Navigate to:', target)} />
        </article>
      </div>
    </div>
  );
}

function SetupScreen({ onSelect }: { onSelect: () => void }) {
  const [isSelecting, setIsSelecting] = useState(false);

  const handleSelectDirectory = async () => {
    setIsSelecting(true);
    try {
      const selected = await window.electronAPI.selectDirectory();
      if (selected) {
        const config = await window.electronAPI.getConfig(selected);
        if (!config.success) {
          const initResult = await window.electronAPI.cmdInit(selected);
          if (!initResult.success) {
            alert('初始化失败: ' + initResult.error);
            return;
          }
        }
        await window.electronAPI.setKbPath(selected);
        onSelect();
      }
    } catch (e) {
      console.error('选择目录失败:', e);
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm w-full mx-4 text-center animate-fadeIn">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/25">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Fina</h1>
        <p className="text-sm text-muted-foreground mb-8">AI 驱动的知识库</p>
        <Button size="lg" className="w-full rounded-xl shadow-sm h-11" onClick={handleSelectDirectory} disabled={isSelecting}>
          {isSelecting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />选择中...</> : <><FolderOpen className="w-5 h-5 mr-2" />选择知识库</>}
        </Button>
        <p className="text-xs text-muted-foreground/60 mt-6">选择一个已有的知识库目录，或创建新目录</p>
      </div>
    </div>
  );
}

export default App;