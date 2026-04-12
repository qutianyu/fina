import * as fs from 'fs-extra';
import * as path from 'path';
import { Session, ChatMessage } from '../types';
import { generateId } from './utils';

export class SessionManager {
  private sessionsDir: string;
  private sessions: Map<string, Session> = new Map();

  constructor(kbDir: string) {
    this.sessionsDir = path.join(kbDir, '.fina', 'sessions');
  }

  async init(): Promise<void> {
    await fs.ensureDir(this.sessionsDir);
    await this.loadAll();
  }

  async createSession(name?: string): Promise<Session> {
    const id = `sess_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);
    const session: Session = {
      id,
      name: name || `Session ${id.slice(-6)}`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.saveSession(session);
    this.sessions.set(id, session);
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    // Try to load from disk if not in memory
    if (!this.sessions.has(id)) {
      const filePath = this.getSessionPath(id);
      if (await fs.pathExists(filePath)) {
        try {
          const session = await fs.readJson(filePath) as Session;
          // Validate session id matches
          if (session.id !== id) {
            console.warn(`Session file ${filePath} has mismatched id: ${session.id} !== ${id}`);
            return null;
          }
          this.sessions.set(id, session);
        } catch (err) {
          console.warn(`Failed to load session ${id}: ${err}`);
          return null;
        }
      } else {
        return null;
      }
    }
    return this.sessions.get(id) || null;
  }

  async listSessions(): Promise<Session[]> {
    const sessions: Session[] = [];

    if (await fs.pathExists(this.sessionsDir)) {
      const files = await fs.readdir(this.sessionsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.sessionsDir, file);
          const session = await fs.readJson(filePath) as Session;
          sessions.push(session);
        }
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(id: string): Promise<void> {
    const filePath = this.getSessionPath(id);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    this.sessions.delete(id);
  }

  async addMessage(sessionId: string, msg: ChatMessage): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) {
      console.warn(`Failed to add message: session ${sessionId} not found`);
      return false;
    }
    session.messages.push(msg);
    session.updatedAt = Math.floor(Date.now() / 1000);
    await this.saveSession(session);
    return true;
  }

  async saveSession(session: Session): Promise<void> {
    const filePath = this.getSessionPath(session.id);
    await fs.ensureDir(this.sessionsDir);
    await fs.writeJson(filePath, session, { spaces: 2 });
    this.sessions.set(session.id, session);
  }

  async loadAll(): Promise<void> {
    if (!await fs.pathExists(this.sessionsDir)) {
      return;
    }

    const files = await fs.readdir(this.sessionsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.sessionsDir, file);
        try {
          const session = await fs.readJson(filePath) as Session;
          this.sessions.set(session.id, session);
        } catch (err) {
          // Skip invalid session files
        }
      }
    }
  }

  async renameSession(id: string, name: string): Promise<boolean> {
    const session = await this.getSession(id);
    if (!session) {
      return false;
    }
    session.name = name;
    session.updatedAt = Math.floor(Date.now() / 1000);
    await this.saveSession(session);
    return true;
  }

  async getMessages(id: string, offset?: number, limit?: number): Promise<ChatMessage[]> {
    const session = await this.getSession(id);
    if (!session) {
      return [];
    }
    let messages = session.messages;
    if (offset !== undefined) {
      messages = messages.slice(offset);
    }
    if (limit !== undefined) {
      messages = messages.slice(0, limit);
    }
    return messages;
  }

  private getSessionPath(id: string): string {
    return path.join(this.sessionsDir, `${id}.json`);
  }
}
