import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      // App
      'app.name': 'Fina',
      'app.tagline': 'AI Knowledge Base',
      
      // Navigation
      'nav.chat': 'Chat',
      'nav.wiki': 'Wiki',
      'nav.commands': 'Commands',
      'nav.settings': 'Settings',
      
      // Chat
      'chat.welcome': 'Welcome to Fina',
      'chat.placeholder': 'Type your message... (Shift+Enter for new line)',
      'chat.send': 'Send',
      'chat.stop': 'Stop',
      'chat.thinking': 'Thinking...',
      'chat.sources': 'Sources',
      'chat.copy': 'Copy',
      'chat.copied': 'Copied',
      
      // Wiki
      'wiki.browser': 'Wiki Browser',
      'wiki.selectFile': 'Select a file to view its content',
      'wiki.metadata': 'Metadata',
      
      // Commands
      'cmd.title': 'Command Panel',
      'cmd.make': 'Make',
      'cmd.makeDeep': 'Deep',
      'cmd.add': 'Add',
      'cmd.batchAdd': 'Batch',
      'cmd.lint': 'Lint',
      'cmd.status': 'Status',
      'cmd.urlPlaceholder': 'Enter URL...',
      'cmd.tasks': 'Tasks',
      'cmd.clear': 'Clear all',
      'cmd.cancel': 'Cancel',
      'cmd.running': 'Running',
      'cmd.completed': 'Completed',
      'cmd.error': 'Error',
      'cmd.cancelled': 'Cancelled',
      'cmd.runPrompt': 'Run a command to see output here',
      
      // Settings
      'settings.title': 'Settings',
      'settings.save': 'Save',
      'settings.reset': 'Reset',
      'settings.test': 'Test',
      'settings.saved': 'Configuration saved successfully',
      'settings.provider': 'AI Provider',
      'settings.baseUrl': 'Base URL',
      'settings.apiKey': 'API Key',
      'settings.model': 'Model',
      'settings.language': 'Language',
      'settings.maxTokens': 'Max Context Tokens',
      'settings.apiKeyHint': 'Your API key is stored locally and never sent to our servers',
      'settings.urlHint': 'Leave default for standard API endpoints',
      'settings.tokensHint': 'Maximum tokens to send to the AI model (1000 - 128000)',
      'settings.selectKb': 'Please select a knowledge base first',
      'settings.apiKeyRequired': 'API Key is required',
      
      // Setup
      'setup.title': 'Fina',
      'setup.description': 'Select a directory to create or open a knowledge base',
      'setup.selectDir': 'Select Directory',
      'setup.selecting': 'Selecting...',
      'setup.initError': 'Failed to initialize',
      
      // Theme
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'theme.system': 'System',
    },
  },
  zh: {
    translation: {
      // App
      'app.name': 'Fina',
      'app.tagline': 'AI 知识库',
      
      // Navigation
      'nav.chat': '对话',
      'nav.wiki': '知识库',
      'nav.commands': '命令',
      'nav.settings': '设置',
      
      // Chat
      'chat.welcome': '欢迎使用 Fina',
      'chat.placeholder': '输入消息... (Shift+Enter 换行)',
      'chat.send': '发送',
      'chat.stop': '停止',
      'chat.thinking': '思考中...',
      'chat.sources': '来源',
      'chat.copy': '复制',
      'chat.copied': '已复制',
      
      // Wiki
      'wiki.browser': '知识库浏览器',
      'wiki.selectFile': '选择文件查看内容',
      'wiki.metadata': '元数据',
      
      // Commands
      'cmd.title': '命令面板',
      'cmd.make': '编译',
      'cmd.makeDeep': '深度',
      'cmd.add': '添加',
      'cmd.batchAdd': '批量',
      'cmd.lint': '检查',
      'cmd.status': '状态',
      'cmd.urlPlaceholder': '输入 URL...',
      'cmd.tasks': '任务',
      'cmd.clear': '清除全部',
      'cmd.cancel': '取消',
      'cmd.running': '运行中',
      'cmd.completed': '已完成',
      'cmd.error': '错误',
      'cmd.cancelled': '已取消',
      'cmd.runPrompt': '运行命令查看输出',
      
      // Settings
      'settings.title': '设置',
      'settings.save': '保存',
      'settings.reset': '重置',
      'settings.test': '测试',
      'settings.saved': '配置保存成功',
      'settings.provider': 'AI 提供商',
      'settings.baseUrl': '基础 URL',
      'settings.apiKey': 'API 密钥',
      'settings.model': '模型',
      'settings.language': '语言',
      'settings.maxTokens': '最大上下文令牌数',
      'settings.apiKeyHint': '您的 API 密钥仅本地存储，不会发送到我们的服务器',
      'settings.urlHint': '使用标准 API 端点请保持默认',
      'settings.tokensHint': '发送到 AI 模型的最大令牌数 (1000 - 128000)',
      'settings.selectKb': '请先选择知识库',
      'settings.apiKeyRequired': 'API 密钥是必需的',
      
      // Setup
      'setup.title': 'Fina',
      'setup.description': '选择目录创建或打开知识库',
      'setup.selectDir': '选择目录',
      'setup.selecting': '选择中...',
      'setup.initError': '初始化失败',
      
      // Theme
      'theme.light': '浅色',
      'theme.dark': '深色',
      'theme.system': '跟随系统',
    },
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
