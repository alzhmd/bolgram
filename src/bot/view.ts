import type { InlineKeyboardButton, InputRichBlock, InputRichMessage, RichMessageButton, RichText, RichBlockTableCell } from '@grammyjs/types';

/**
 * One screen description, two renderings:
 *  - Telegram: a rich message (sendRichMessage / editMessageText.rich_message) with buttons
 *    inside the content (RichBlockButtons, RichTextButton), compact tables and
 *    expandable quotes.
 *  - Bale (and Telegram fallback): plain text + inline keyboard.
 */
export type Tone = 'primary' | 'success' | 'danger' | 'link';
export interface Btn {
  text: string;
  data?: string;
  url?: string;
  copy?: string;
  tone?: Tone;
}
export type Piece = string | { b: string } | { code: string } | { mark: string } | { btn: Btn };
export type Part =
  | { t: 'h'; text: string; size?: 1 | 2 | 3 | 4 }
  | { t: 'p'; line: Piece[] | string }
  | { t: 'table'; head?: string[]; rows: string[][]; caption?: string }
  | { t: 'quote'; text: string; credit?: string }
  | { t: 'details'; summary: string; parts: Part[]; open?: boolean }
  | { t: 'list'; items: string[] }
  | { t: 'hr' }
  | { t: 'footer'; text: string }
  | { t: 'buttons'; row: Btn[] };
export type View = Part[];

export interface Caps {
  rich: boolean;
  copy: boolean;
  style: boolean;
}

// ---------------------------------------------------------------- Telegram rich

function richButton(b: Btn): RichMessageButton {
  const base = { text: b.text, ...(b.tone ? { style: b.tone } : {}) };
  if (b.url) return { ...base, url: b.url };
  if (b.copy) return { ...base, copy_text: { text: b.copy } };
  return { ...base, callback_data: b.data || 'noop' };
}

function richText(line: Piece[] | string): RichText {
  if (typeof line === 'string') return line;
  return line.map((p): RichText => {
    if (typeof p === 'string') return p;
    if ('b' in p) return { type: 'bold', text: p.b };
    if ('code' in p) return { type: 'code', text: p.code };
    if ('mark' in p) return { type: 'marked', text: p.mark };
    return { type: 'button', button: richButton(p.btn) };
  });
}

const cell = (text: string, header = false): RichBlockTableCell => ({ text, ...(header ? { is_header: true as const } : {}), align: 'center', valign: 'middle' });

function richBlocks(view: View): InputRichBlock<never>[] {
  const out: InputRichBlock<never>[] = [];
  for (const p of view) {
    switch (p.t) {
      case 'h': out.push({ type: 'heading', text: p.text, size: p.size || 2 }); break;
      case 'p': out.push({ type: 'paragraph', text: richText(p.line) }); break;
      case 'table':
        out.push({
          type: 'table',
          is_compact: true,
          is_striped: true,
          is_bordered: true,
          cells: [...(p.head ? [p.head.map((h) => cell(h, true))] : []), ...p.rows.map((r) => r.map((c) => cell(c)))],
          ...(p.caption ? { caption: p.caption } : {}),
        });
        break;
      case 'quote': out.push({ type: 'expandable_blockquote', text: p.text, ...(p.credit ? { credit: p.credit } : {}) }); break;
      case 'details': out.push({ type: 'details', summary: p.summary, blocks: richBlocks(p.parts), ...(p.open ? { is_open: true as const } : {}) }); break;
      case 'list': out.push({ type: 'list', items: p.items.map((x) => ({ blocks: [{ type: 'paragraph', text: x }] })) }); break;
      case 'hr': out.push({ type: 'divider' }); break;
      case 'footer': out.push({ type: 'footer', text: p.text }); break;
      case 'buttons':
        // A buttons block holds 1-8 buttons shown in one row.
        for (let i = 0; i < p.row.length; i += 8) out.push({ type: 'buttons', buttons: p.row.slice(i, i + 8).map(richButton), align: 'center' });
        break;
    }
  }
  return out;
}

export function toRichMessage(view: View): InputRichMessage<never> {
  return { blocks: richBlocks(view), is_rtl: true };
}

// ---------------------------------------------------------------- plain text + keyboard

function plainPiece(p: Piece): string {
  if (typeof p === 'string') return p;
  if ('b' in p) return p.b;
  if ('code' in p) return p.code;
  if ('mark' in p) return p.mark;
  return '';
}

function keyboardButton(b: Btn, caps: Caps): InlineKeyboardButton | null {
  const style = caps.style && b.tone && b.tone !== 'link' ? { style: b.tone } : {};
  if (b.url) return { text: b.text, url: b.url, ...style };
  if (b.copy) return caps.copy ? { text: b.text, copy_text: { text: b.copy }, ...style } : null;
  return { text: b.text, callback_data: b.data || 'noop', ...style };
}

export function toPlain(view: View, caps: Caps): { text: string; keyboard: InlineKeyboardButton[][] } {
  const lines: string[] = [];
  const keyboard: InlineKeyboardButton[][] = [];
  const pushRow = (row: Btn[]) => {
    const btns = row.map((b) => keyboardButton(b, caps)).filter((b): b is InlineKeyboardButton => !!b);
    for (let i = 0; i < btns.length; i += 3) keyboard.push(btns.slice(i, i + 3));
  };
  const walk = (parts: View, indent = '') => {
    for (const p of parts) {
      switch (p.t) {
        case 'h': lines.push('', `${indent}◆ ${p.text}`); break;
        case 'p': {
          const pieces = typeof p.line === 'string' ? [p.line] : p.line;
          lines.push(indent + pieces.map(plainPiece).join('').trim());
          const inline = pieces.filter((x): x is { btn: Btn } => typeof x !== 'string' && 'btn' in x).map((x) => x.btn);
          if (inline.length) pushRow(inline);
          break;
        }
        case 'table':
          if (p.caption) lines.push(`${indent}${p.caption}`);
          for (const r of p.rows) {
            if (r.length === 2) lines.push(`${indent}▫️ ${r[0]}: ${r[1]}`);
            else lines.push(`${indent}▫️ ${r.join(' · ')}`);
          }
          break;
        case 'quote': lines.push(...p.text.split('\n').map((l) => `${indent}┃ ${l}`)); if (p.credit) lines.push(`${indent}┃ — ${p.credit}`); break;
        case 'details': lines.push(`${indent}▸ ${p.summary}`); walk(p.parts, indent + '  '); break;
        case 'list': lines.push(...p.items.map((x) => `${indent}• ${x}`)); break;
        case 'hr': lines.push('──────────'); break;
        case 'footer': lines.push('', `${indent}${p.text}`); break;
        case 'buttons': pushRow(p.row); break;
      }
    }
  };
  walk(view);
  const text = lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').slice(0, 4000);
  return { text: text || '…', keyboard };
}
