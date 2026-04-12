import { useState, useEffect } from 'react';
import { Save, RefreshCw, Bot, Server, Key, Globe, Database, Check } from 'lucide-react';
import { useKbStore } from '../stores/kbStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Config { type: 'anthropic' | 'openai'; baseUrl: string; apiKey: string; model: string; language: string; maxContextTokens: number; }

const DEFAULT_CONFIG: Config = { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-3-sonnet-20240229', language: 'en', maxContextTokens: 8000 };
const PRESET_MODELS = {
  anthropic: [{ value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' }, { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' }, { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' }],
  openai: [{ value: 'gpt-4-turbo', label: 'GPT-4 Turbo' }, { value: 'gpt-4', label: 'GPT-4' }, { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }],
};

export function SettingsPanel() {
  const { kbPath } = useKbStore();
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState<Config>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { if (kbPath) loadConfig(); }, [kbPath]);

  const loadConfig = async () => {
    if (!kbPath) return;
    try { const r = await window.electronAPI.getConfig(kbPath); if (r.success && r.config) { const l = { ...DEFAULT_CONFIG, ...r.config }; setConfig(l); setOriginalConfig(l); } }
    catch (e) { console.error('Failed to load config:', e); }
  };

  const handleSave = async () => {
    if (!kbPath) { setMessage({ type: 'error', text: '请先选择知识库' }); return; }
    if (!config.apiKey.trim()) { setMessage({ type: 'error', text: 'API 密钥是必需的' }); return; }
    setIsSaving(true); setMessage(null);
    try {
      const r = await window.electronAPI.updateConfig(kbPath, config);
      if (r.success) { setOriginalConfig(config); setMessage({ type: 'success', text: '配置保存成功' }); }
      else { setMessage({ type: 'error', text: r.error || '保存失败' }); }
    } catch (e) { setMessage({ type: 'error', text: String(e) }); }
    finally { setIsSaving(false); }
  };

  const hasChanges = JSON.stringify(config) !== JSON.stringify(originalConfig);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto py-10 px-8">
        <div className="mb-8">
          <h1 className="text-xl font-semibold">设置</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你的知识库配置和 AI 提供商设置</p>
        </div>

        {message && (
          <div className={`mb-6 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-fadeIn ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.type === 'success' ? <Check className="w-4 h-4 flex-shrink-0" /> : <span className="w-4 h-4 flex-shrink-0">✕</span>}
            {message.text}
          </div>
        )}

        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><Bot className="w-4 h-4 text-blue-500" /></div>
              <div><h2 className="text-sm font-semibold">AI 提供商</h2><p className="text-xs text-muted-foreground">选择你的 AI 模型提供商和配置</p></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">提供商类型</label>
              <Select value={config.type} onValueChange={(v) => { const t = v as 'anthropic' | 'openai'; setConfig({ ...config, type: t, model: PRESET_MODELS[t][0].value, baseUrl: t === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com' }); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Key className="w-3.5 h-3.5" />API 密钥</label>
              <Input type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} placeholder="sk-..." />
              <p className="text-[11px] text-muted-foreground mt-1">密钥仅存储在本地，不会上传到任何服务器</p>
            </div>
            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Database className="w-3.5 h-3.5" />模型</label>
              <Select value={config.model} onValueChange={(v) => setConfig({ ...config, model: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PRESET_MODELS[config.type].map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><Server className="w-4 h-4 text-amber-500" /></div>
              <div><h2 className="text-sm font-semibold">服务器</h2><p className="text-xs text-muted-foreground">自定义 API 端点和语言偏好</p></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">基础 URL</label>
              <Input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} placeholder="https://api..." />
              <p className="text-[11px] text-muted-foreground mt-1">适用于代理或自建端点，留空使用官方地址</p>
            </div>
            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" />语言</label>
              <Select value={config.language} onValueChange={(v) => setConfig({ ...config, language: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3 mt-6">
          {hasChanges && <Button variant="ghost" onClick={() => { setConfig(originalConfig); setMessage(null); }}>还原更改</Button>}
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {isSaving ? '保存中...' : '保存配置'}
          </Button>
        </div>
      </div>
    </div>
  );
}