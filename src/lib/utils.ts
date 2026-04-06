export function generateId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `${time}-${rand}`;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5.]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/\.-/g, '-')
    .replace(/-\./g, '-')
    .substring(0, 80);
}
