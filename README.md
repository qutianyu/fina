# Fina

**Fina** is a personal AI Knowledge Base CLI, inspired by Andrej Karpathy's vision of building a "second brain" with LLMs.

Following Karpathy's insight that *"LLMs are the new operating system"*, Fina acts as the interface layer between you and your personal knowledge OS. It transforms raw materials—URLs, documents, code—into a queryable wiki, enabling infinite-context search and AI-powered Q&A over everything you've collected.

**Build your own knowledge base. Let AI remember what you read.**

![fina logo](logo.png)

## Core Features

### 1. Content Collection
- **Add URLs**: `fina add <url> [kb-path]` Automatically fetch and extract web content, cleaning ads and irrelevant content
- **Add local files**: `fina add <file-path> [kb-path]` Support for Markdown, text, code files, images, and more
- **Batch add**: `fina batch-add <dir> [kb-path]` Recursively import all supported files from a directory

### 2. Intelligent Compilation (make)
- **AI summaries**: Automatically generate concise summaries for each article
- **Concept extraction**: Identify and extract key concepts
- **Content compression**: Preserve core information while reducing redundancy
- **Relationship building**: Automatically establish connections between articles and concepts
- **Smart batch processing**: When content is below `maxContextTokens`, process all at once; otherwise auto-batch

### 3. Knowledge Q&A (search / run)
- **Semantic search**: Understand questions via LLM and retrieve relevant content
- **Multi-turn dialogue**: Support contextual conversation in interactive mode
- **Source citations**: Answers include absolute file paths for traceability

### 4. Status View (status)
- View raw materials count and type statistics
- View Wiki compilation status (summaries, concepts)
- View index metadata

## Installation

```bash
git clone https://github.com/qutianyu/fina
cd ./fina
npm install -g fina
```

## Quick Start

```bash
# 1. Initialize a knowledge base
fina init {path}/my-wiki

# 2. Add web content (supports WeChat, Xiaohongshu, etc.)
fina add https://example.com/article {path}/my-wiki

# 3. Add local file (single file)
fina add {path}/my-doc/article.md {path}/my-wiki

# 4. Batch add (recursively import entire directory)
fina batch-add {path}/my-docs {path}/my-wiki

# 5. Compile the Wiki
fina make {path}/my-wiki

# 6. Ask questions directly
fina search "What is Elasticsearch" {path}/my-wiki

# 7. Or enter interactive mode (supports multi-turn dialogue)
fina run {path}/my-wiki
```

## Commands

| Command | Description |
|---------|-------------|
| `fina init <path>` | Initialize a new knowledge base |
| `fina add <source>` | Add URL or local file to raw materials |
| `fina batch-add <dir>` | Recursively add all files from directory |
| `fina make [path]` | Compile/refresh Wiki (summaries, concepts, relationships) |
| `fina search <query>` | LLM-powered knowledge base search |
| `fina status [path]` | Show knowledge base statistics |
| `fina run [path]` | Start interactive Shell (multi-turn capable) |

## Configuration

Edit `.fina/config.json` in your knowledge base directory:

```json
{
  "type": "anthropic",
  "apiKey": "",
  "baseUrl": "",
  "model": "",
  "language": "en",
  "maxContextTokens": 100000
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `type` | API provider (`anthropic` or `openai`) | `anthropic` |
| `apiKey` | Your API key | - |
| `baseUrl` | Custom API URL (optional) | - |
| `model` | Model name to use | - |
| `language` | UI language (`en` or `zh`) | `en` |
| `maxContextTokens` | Batch processing limit, processes all at once when below | `100000` |

## Architecture

```
knowledge-base/
├── .fina/           # Configuration
│   ├── config.json  # Config file
│   └── skills/      # Custom URL extraction rules
├── raw/             # Raw materials (organized by timestamp)
│   ├── articles/    # Articles (Markdown/text)
│   ├── documents/   # Other documents
│   ├── code/        # Source code
│   └── images/      # Images
└── wiki/            # Compiled output
    ├── summaries/   # Article summaries (mirrors raw structure)
    ├── concepts/    # Concept definitions
    └── index.json   # Index metadata
```

## Workflow

```
Add content (add/batch-add)
    ↓
Raw materials → raw/
    ↓
Compile Wiki (make)
    ├─ Read all content
    ├─ Estimate token count
    ├─ Process all at once or batch
    │   ├─ AI generate summaries
    │   ├─ Extract key concepts
    │   └─ Compress preserving meaning
    ├─ Build relationships
    └─ Output to wiki/
    ↓
Q&A (search/run)
    ├─ Retrieve relevant content
    ├─ Build context
    └─ LLM generate answer (with sources)
```

## Use Cases

- **Personal knowledge management**: Collect and organize web articles, technical docs
- **Study notes**: Import learning materials, AI-assisted summarization and Q&A
- **Code documentation**: Import code snippets, auto-generate docs and relationships
- **Content library**: Build a searchable local content base

## License

MIT
