import { Settings, Moon, Sun, Monitor, BookOpen, Bot } from 'lucide-react';
import { useThemeStore } from '../stores/themeStore';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface HeaderProps {
  breadcrumbs: string[];
  onNavigateHome: () => void;
  onOpenSettings: () => void;
  currentView: 'doc' | 'chat' | 'settings';
  onSwitchView: (view: 'doc' | 'chat' | 'settings') => void;
}

export function Header({ breadcrumbs, onNavigateHome, onOpenSettings, currentView, onSwitchView }: HeaderProps) {
  const { theme, setTheme } = useThemeStore();
  const themeIcons = { light: <Sun className="w-3.5 h-3.5" />, dark: <Moon className="w-3.5 h-3.5" />, system: <Monitor className="w-3.5 h-3.5" /> };

  return (
    <TooltipProvider delayDuration={300}>
      <header className="h-12 flex items-center px-4 gap-3 bg-card flex-shrink-0">
        {/* Left - Breadcrumbs */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNavigateHome}><BookOpen className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent>首页</TooltipContent></Tooltip>
          {breadcrumbs.length > 0 && (
            <>
              <span className="text-muted-foreground/40 text-xs">/</span>
              <div className="flex items-center gap-1 overflow-hidden">
                {breadcrumbs.map((crumb, i) => (
                  <div key={i} className="flex items-center gap-1 min-w-0">
                    {i > 0 && <span className="text-muted-foreground/40 text-xs">/</span>}
                    <span className={`text-[13px] truncate max-w-[140px] ${i === breadcrumbs.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{crumb}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Center - View Switcher */}
        <div className="pill-switcher">
          <button onClick={() => onSwitchView('doc')} className={currentView === 'doc' ? 'active' : ''}>
            <BookOpen className="w-3.5 h-3.5 mr-1 inline" />文档
          </button>
          <button onClick={() => onSwitchView('chat')} className={currentView === 'chat' ? 'active' : ''}>
            <Bot className="w-3.5 h-3.5 mr-1 inline" />AI
          </button>
        </div>

        {/* Right - Actions */}
        <div className="flex items-center gap-1.5 flex-1 justify-end">
          <div className="flex items-center bg-secondary rounded-md p-0.5">
            {(['light', 'dark', 'system'] as const).map(t => (
              <Button key={t} variant="ghost" size="icon" className={`h-7 w-7 rounded-sm text-xs ${theme === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setTheme(t)}>
                {themeIcons[t]}
              </Button>
            ))}
          </div>
          <Separator orientation="vertical" className="h-5" />
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className={`h-8 w-8 ${currentView === 'settings' ? 'bg-accent text-accent-foreground' : ''}`} onClick={onOpenSettings}><Settings className="w-4 h-4" /></Button></TooltipTrigger><TooltipContent>设置</TooltipContent></Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}