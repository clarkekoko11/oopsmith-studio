// Small, safe markdown for chat bubbles: headings, lists, quotes, bold/italic, code, links.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r/g, '').split('\n');
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let quote: string[] = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { html.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushPara(); flushList(); flushQuote(); html.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = line.match(/^>\s?(.*)/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) { flushPara(); flushQuote(); if (list !== 'ul') { flushList(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); flushQuote(); if (list !== 'ol') { flushList(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    if (/^[-*_]{3,}$/.test(line.trim())) { flushPara(); flushList(); flushQuote(); html.push('<hr>'); continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flushPara(); flushList(); flushQuote();
  return html.join('');
}
