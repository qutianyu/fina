# Fina

[English version](README.md)

**Fina** 是一个个人 AI 知识库命令行工具，受 Andrej Karpathy "第二大脑" 愿景的启发。

遵循 Karpathy 的观点——*"LLM 是新的操作系统"*，Fina 作为你与个人知识 OS 之间的接口层。它将原始材料（URL、文档、代码）转换成可查询的 wiki，实现无限上下文的搜索和 AI 驱动的问答。

**构建你自己的知识库。让 AI 记住你读过的内容。**

![fina logo](logo.png)

## 核心功能

### 1. 内容采集

- **添加 URL**：`fina add <url> [kb-path]` 支持网页 URL 自动抓取和内容提取，自动清理广告和无关内容
- **添加本地文件**：`fina add <file-path> [kb-path]` 支持 Markdown、纯文本、代码文件、图片等单个文件
- **批量添加**：`fina batch-add <dir> [kb-path]` 递归导入整个目录下的所有支持的文件类型

### 2. 智能编译 (make)

- **AI 生成摘要**：自动为每篇文章生成简洁摘要
- **概念提取**：自动识别和提取关键概念
- **内容压缩**：保留原文核心信息，减少冗余
- **关系构建**：自动建立文章之间、概念之间的关联
- **智能批量处理**：当内容小于 `maxContextTokens` 时，一次性处理全部；内容较多时自动分批处理

### 3. 知识问答 (search / run)

- **语义搜索**：基于 LLM 理解问题，从知识库中检索相关内容
- **多轮对话**：在交互模式下支持上下文连续对话
- **来源引用**：回答附带文档绝对路径，方便溯源

### 4. 状态查看 (status)

- 查看原始材料数量和类型统计
- 查看 Wiki 编译状态（摘要数、概念数）
- 查看索引信息

## 安装

```bash
git clone https://github.com/qutianyu/fina
cd ./fina
npm install -g fina
```

## 快速开始

```bash
# 1. 初始化知识库
fina init {path}/my-wiki

# 2. 添加网络内容（支持微信公众号、小红书等）
fina add https://example.com/article {path}/my-wiki

# 3. 添加本地文件（单个文件）
fina add {path}/my-doc/article.md {path}/my-wiki

# 4. 批量添加（递归导入整个目录）
fina batch-add {path}/my-docs {path}/my-wiki

# 5. 编译生成 Wiki
fina make {path}/my-wiki

# 6. 直接提问
fina search "什么是 Elasticsearch" {path}/my-wiki

# 7. 或进入交互模式（支持多轮对话）
fina run {path}/my-wiki
```

## 命令

| 命令                      | 描述                                           |
| ------------------------- | ---------------------------------------------- |
| `fina init <路径>`      | 初始化新知识库                                 |
| `fina add <来源>`       | 添加 URL 或本地文件到原始材料                  |
| `fina batch-add <目录>` | 递归添加目录下所有文件                         |
| `fina make [路径]`      | 编译/刷新 Wiki（生成摘要、提取概念、建立关联） |
| `fina search <问题>`    | 基于 LLM 搜索知识库并生成回答                  |
| `fina status [路径]`    | 显示知识库状态统计                             |
| `fina run [路径]`       | 进入交互式 Shell（可多轮对话）                 |

## 配置

在知识库目录下的 `.fina/config.json` 中编辑：

```json
{
  "type": "anthropic",
  "apiKey": "",
  "baseUrl": "",
  "model": "",
  "language": "zh",
  "maxContextTokens": 100000
}
```

### 配置选项

| 选项                 | 描述                                      | 默认值        |
| -------------------- | ----------------------------------------- | ------------- |
| `type`             | API 提供商（`anthropic` 或 `openai`） | `anthropic` |
| `apiKey`           | 你的 API 密钥                             | -             |
| `baseUrl`          | 自定义 API 地址（可选）                   | -             |
| `model`            | 使用的模型名称                            | -             |
| `language`         | 界面语言（`en` 或 `zh`）              | `en`        |
| `maxContextTokens` | 批量处理上限，低于此值时一次性处理        | `100000`    |

## 架构

```
knowledge-base/
├── .fina/           # 配置目录
│   ├── config.json  # 配置文件
│   └── skills/      # 自定义 URL 提取规则
├── raw/             # 原始材料（按时间戳组织）
│   ├── articles/    # 文章（Markdown/文本）
│   ├── documents/   # 其他文档
│   ├── code/        # 源代码
│   └── images/      # 图片
└── wiki/            # 编译输出
    ├── summaries/   # 文章摘要（按原始目录结构）
    ├── concepts/    # 概念定义
    └── index.json   # 索引元数据
```

## 工作流程

```
添加内容 (add/batch-add)
    ↓
原始材料存入 raw/
    ↓
编译 Wiki (make)
    ├─ 读取全部内容
    ├─ 估算 token 数量
    ├─ 一次性或分批处理
    │   ├─ AI 生成摘要
    │   ├─ 提取关键概念
    │   └─ 压缩保留原意
    ├─ 建立关联关系
    └─ 输出到 wiki/
    ↓
问答 (search/run)
    ├─ 检索相关内容
    ├─ 构建上下文
    └─ LLM 生成回答（含来源）
```

## 适用场景

- **个人知识管理**：收集整理网络文章、技术文档
- **学习笔记**：批量导入学习资料，AI 辅助总结和问答
- **代码文档化**：导入代码片段，自动生成文档和关联
- **内容库**：构建可查询的本地内容库

## 许可证

MIT
