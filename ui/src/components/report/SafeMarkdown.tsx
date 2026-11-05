import React from 'react';

const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|#)[^)]+\))/g;

function inline(text: string): React.ReactNode[] {
  return text.split(tokenPattern).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-text">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-ink-950 px-1 py-0.5 font-mono text-accent">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|#)[^)]+)\)$/);
    return link ? <a key={index} href={link[2]} target={link[2].startsWith('#') ? undefined : '_blank'} rel="noreferrer" className="text-accent underline underline-offset-2">{link[1]}</a> : <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export const SafeMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split(/\r?\n/); const blocks: React.ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { blocks.push(<h4 key={index} className="mt-4 text-base font-semibold text-text">{inline(heading[2])}</h4>); index += 1; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) items.push(lines[index++].trim().replace(/^[-*]\s+/, ''));
      blocks.push(<ul key={`list-${index}`} className="my-2 list-disc space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>); continue;
    }
    const paragraph = [line]; index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}|[-*])\s+/.test(lines[index].trim())) paragraph.push(lines[index++].trim());
    blocks.push(<p key={`paragraph-${index}`} className="my-2">{inline(paragraph.join(' '))}</p>);
  }
  return <div className="text-sm leading-7 text-text">{blocks}</div>;
};
