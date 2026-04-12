import { ipcMain } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import matter from 'gray-matter';
import { ConfigManager } from '@fina/core';

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  fileType?: 'markdown' | 'image' | 'json' | 'code' | 'other';
  size?: number;
  modified?: string;
}

function getFileType(ext: string): FileTreeNode['fileType'] {
  const extLower = ext.toLowerCase();
  if (['.md', '.markdown'].includes(extLower)) return 'markdown';
  if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(extLower)) return 'image';
  if (extLower === '.json') return 'json';
  if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h'].includes(extLower)) return 'code';
  return 'other';
}

async function buildFileTree(dir: string, basePath: string): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(basePath, fullPath);

    // Skip .fina directory except for sessions
    if (entry.name === '.fina') {
      continue;
    }

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, basePath);
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: relativePath,
          isDir: true,
          children,
        });
      }
    } else {
      const stat = await fs.stat(fullPath);
      const ext = path.extname(entry.name);
      nodes.push({
        name: entry.name,
        path: relativePath,
        isDir: false,
        fileType: getFileType(ext),
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

// Build wiki tree with three roots: raw, wiki, output
ipcMain.handle('wiki:tree', async (_event, kbPath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const roots: FileTreeNode[] = [];

    // Raw directory
    const rawPath = path.join(kbPath, 'raw');
    if (await fs.pathExists(rawPath)) {
      const rawChildren = await buildFileTree(rawPath, kbPath);
      roots.push({
        name: 'raw',
        path: 'raw',
        isDir: true,
        children: rawChildren,
      });
    }

    // Wiki directory
    const wikiPath = path.join(kbPath, 'wiki');
    if (await fs.pathExists(wikiPath)) {
      const wikiChildren = await buildFileTree(wikiPath, kbPath);
      roots.push({
        name: 'wiki',
        path: 'wiki',
        isDir: true,
        children: wikiChildren,
      });
    }

    // Output directory
    const outputPath = path.join(kbPath, 'wiki', 'output');
    if (await fs.pathExists(outputPath)) {
      // Already included in wiki tree
    }

    return { success: true, roots };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Read file content
ipcMain.handle('wiki:file', async (_event, kbPath: string, filePath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

const fullPath = path.join(kbPath, filePath);
    config.validateRead(fullPath);

    const content = await fs.readFile(fullPath, 'utf-8');
    const ext = path.extname(filePath);

    if (ext === '.md') {
      const parsed = matter(content);
      return {
        success: true,
        content: parsed.content,
        frontmatter: parsed.data,
        path: filePath,
      };
    }

    return {
      success: true,
      content,
      path: filePath,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Read raw file (for images)
ipcMain.handle('wiki:file-raw', async (_event, kbPath: string, filePath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const fullPath = path.join(kbPath, filePath);
    // Validate path is within KB (throws on invalid path)
    config.validateRead(fullPath);

    if (!(await fs.pathExists(fullPath))) {
      throw new Error('File not found');
    }

    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(filePath).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const base64 = buffer.toString('base64');

    return {
      success: true,
      mimeType,
      base64,
      path: filePath,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Get concepts index
ipcMain.handle('wiki:concepts', async (_event, kbPath: string) => {
  try {
    const indexPath = path.join(kbPath, 'wiki', 'concepts-index.json');
    if (!(await fs.pathExists(indexPath))) {
      return { success: true, concepts: {} };
    }
    const data = await fs.readJson(indexPath);
    return { success: true, concepts: data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Get sources index
ipcMain.handle('wiki:sources', async (_event, kbPath: string) => {
  try {
    const indexPath = path.join(kbPath, 'wiki', 'sources-index.json');
    if (!(await fs.pathExists(indexPath))) {
      return { success: true, sources: {} };
    }
    const data = await fs.readJson(indexPath);
    return { success: true, sources: data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});
