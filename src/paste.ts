// Turn pasted rich text (Google Docs, Notion, web pages) into markdown.
// Handles headings, bold/italic, links, lists, quotes, code and tables.
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = block(doc.body, 0).replace(/\n{3,}/g, "\n\n").trim();
  return out + "\n";
}

function block(el: Node, depth: number): string {
  let s = "";
  el.childNodes.forEach((n) => { s += node(n, depth); });
  return s;
}

function inline(el: Node): string {
  let s = "";
  el.childNodes.forEach((n) => { s += node(n, 0, true); });
  return s.replace(/\s*\n\s*/g, " ");
}

function wrap(text: string, mark: string) {
  const m = text.match(/^(\s*)(.*?)(\s*)$/s)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function node(n: Node, depth: number, inLine = false): string {
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (n.nodeType !== Node.ELEMENT_NODE) return "";
  const el = n as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const style = el.getAttribute("style") ?? "";
  // Google Docs marks bold/italic with inline styles on spans.
  const bold = tag === "b" || tag === "strong" || /font-weight:\s*(bold|[6-9]00)/.test(style);
  const italic = tag === "i" || tag === "em" || /font-style:\s*italic/.test(style);
  // Google Docs wraps the whole paste in <b style="font-weight:normal">.
  const fakeBold = tag === "b" && /font-weight:\s*normal/.test(style);

  switch (tag) {
    case "script": case "style": case "meta": case "title": return "";
    case "br": return inLine ? " " : "\n";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return `\n\n${"#".repeat(Number(tag[1]))} ${inline(el).trim()}\n\n`;
    case "p": { const t = inline(el).trim(); return t ? `\n\n${t}\n\n` : ""; }
    case "a": {
      const t = inline(el).trim(), href = el.getAttribute("href") ?? "";
      return href && !href.startsWith("javascript:") ? `[${t || href}](${href})` : t;
    }
    case "code": return inLine || el.parentElement?.tagName !== "PRE" ? `\`${el.textContent}\`` : el.textContent ?? "";
    case "pre": return `\n\n\`\`\`\n${(el.textContent ?? "").replace(/\n$/, "")}\n\`\`\`\n\n`;
    case "blockquote": return "\n\n" + block(el, depth).trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
    case "hr": return "\n\n---\n\n";
    case "ul": case "ol": {
      let i = 0, s = "";
      el.childNodes.forEach((c) => {
        if ((c as HTMLElement).tagName === "LI") {
          i++;
          const li = c as HTMLElement;
          const own = [...li.childNodes].filter((x) => !["UL", "OL"].includes((x as HTMLElement).tagName));
          const nested = [...li.childNodes].filter((x) => ["UL", "OL"].includes((x as HTMLElement).tagName));
          const text = own.map((x) => node(x, depth, true)).join("").replace(/\s+/g, " ").trim();
          s += `${"  ".repeat(depth)}${tag === "ol" ? `${i}.` : "-"} ${text}\n`;
          nested.forEach((x) => { s += node(x, depth + 1).replace(/^\n+|\n+$/g, "") + "\n"; });
        } else if (["UL", "OL"].includes((c as HTMLElement).tagName)) {
          s += node(c, depth + 1).replace(/^\n+|\n+$/g, "") + "\n"; // Google Docs nests lists as siblings
        }
      });
      return depth ? s : `\n\n${s}\n`;
    }
    case "table": {
      const rows = [...el.querySelectorAll("tr")].map((r) => [...r.children].map((c) => inline(c).trim().replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: w }, (_, k) => r[k] ?? "").join(" | ")} |`;
      return `\n\n${line(rows[0])}\n|${" --- |".repeat(w)}\n${rows.slice(1).map(line).join("\n")}\n\n`;
    }
  }
  const hasBlocks = !!el.querySelector("p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,div,hr");
  if (hasBlocks && !inLine) return block(el, depth); // e.g. Google Docs' outer <b> wrapper
  let inner = inLine || ["span", "b", "strong", "i", "em", "u", "s", "font", "sup", "sub", "mark"].includes(tag) ? inline(el) : block(el, depth);
  if (bold && !fakeBold) inner = wrap(inner, "**");
  if (italic) inner = wrap(inner, "*");
  if (tag === "s" || tag === "del" || /line-through/.test(style)) inner = wrap(inner, "~~");
  return inner;
}
