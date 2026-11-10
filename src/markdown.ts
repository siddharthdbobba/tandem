import DOMPurify from "dompurify";
import { marked } from "marked";

// breaks: a single Enter is a new line, the way people write in chat and notes.
marked.setOptions({ gfm: true, breaks: true });

// Agents see the VM's absolute workspace path. People don't need it.
export const tidyPaths = (t: string) =>
  t
    // "(`/srv/.../ws`)" or "`/srv/.../ws`" on its own: just drop it.
    .replace(/\s*\(`?\/srv\/tandem\/workspaces\/[a-z0-9]+\/?`?\)/g, "")
    .replace(/`\/srv\/tandem\/workspaces\/[a-z0-9]+\/?`/g, "the workspace")
    // Inside longer paths, show them relative to the workspace.
    .replace(/\/srv\/tandem\/workspaces\/[a-z0-9]+\/(?=\S)/g, "")
    .replace(/\/srv\/tandem\/workspaces\/[a-z0-9]+\/?/g, ".");

// Markdown -> sanitized HTML. Links open in a new tab.
export function renderMarkdown(src: string): string {
  const html = marked.parse(tidyPaths(src), { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return clean.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
