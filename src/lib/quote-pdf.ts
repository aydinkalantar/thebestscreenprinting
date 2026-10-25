// Branded "Design Request Summary" PDF, attached to both the shop and the customer emails.
// Pure (no Worker APIs) so it can be rendered from Node for review.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { business } from '../data/business';
import { placementPosition, placementSide, placementSize, sizesText, turnaroundTier, type Placement, type QuoteItem, type QuoteRequest } from './quote';

/** Shop hours as written across the site (business.openingHours, Los Angeles time). */
export const HOURS = 'Monday to Friday, 9am to 5pm Pacific';

export const MOCKUP_DISCLAIMER = 'Mockups are a visual guide. Final print size, placement and colors are confirmed on your proof before production.';

/** Verbatim from "## About Your Mockup" in src/content/pages/terms-conditions.md. */
export const ABOUT_MOCKUP = [
  "Your mockup is a digital preview made to help us quote and plan your order. It is not an exact representation of the finished product. Screens, cameras and garment photos show color differently, and each decoration method, fabric and garment color affects how ink and thread look in real life. Print size and placement are approximate and may be adjusted to fit the garment's sizes and seams and to follow production best practices.",
  'Before anything is produced, we send you a digital proof with the final artwork size, placement and colors (including PMS or thread colors when provided). Production starts only after you approve it. If exact color matching matters, tell us your PMS colors or ask for a pre-production sample.',
];

export interface PdfMockup { side: string; label: string; png: Uint8Array }
export interface QuotePdfInput {
  ref: string;
  date: Date;
  quote: QuoteRequest;
  placements?: Placement[];
  artworkNames?: string[];
  mockups?: PdfMockup[];
  /** PNG bytes of the TBSP shield (public/icon-512.png). Optional: the header falls back to text only. */
  logoPng?: Uint8Array | null;
  /** Quote cart: one entry per product, each with its own files and mockups. */
  items?: PdfItem[];
}
export interface PdfItem { item: QuoteItem; artworkNames: string[]; mockups: PdfMockup[] }

/** Keeps the PDF small enough to attach; past this the mockup images are left out (they are attached to the email anyway). */
export const MAX_PDF_BYTES = 3 * 1024 * 1024;

const W = 612, H = 792, M = 48, CONTENT_W = W - M * 2, FOOTER_H = 54;
const INK = rgb(0.094, 0.094, 0.106), MUTED = rgb(0.443, 0.443, 0.478), LINE = rgb(0.894, 0.894, 0.906);
const SOFT = rgb(0.957, 0.957, 0.961), ACCENT = rgb(0.427, 0.157, 0.851);

export const formatRequestDate = (d: Date) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(d)} ET`;

export const formatNeededBy = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
};

export const turnaroundLine = (label: string) => {
  const t = turnaroundTier(label);
  return [t.name, t.time, t.fee].filter(Boolean).join(' · ');
};

export async function buildQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const all = [...(input.mockups ?? []), ...(input.items ?? []).flatMap((i) => i.mockups)];
  if (!all.length) return render(input, false);
  // PNGs are embedded as they are, so their bytes are a floor for the PDF: skip a render that can't fit.
  const pngBytes = all.reduce((n, m) => n + m.png.length, 0);
  if (pngBytes > MAX_PDF_BYTES * 0.95) return render(input, false);
  const bytes = await render(input, true);
  return bytes.length <= MAX_PDF_BYTES ? bytes : render(input, false);
}

async function render(input: QuotePdfInput, withImages: boolean): Promise<Uint8Array> {
  const { ref, date, quote: q, placements = [], artworkNames = [], mockups = [] } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Design Request Summary ${ref}`);
  doc.setAuthor(business.name);
  doc.setSubject(`${q.quantity} × ${q.garment} for ${q.name}`);
  doc.setCreator(business.url);
  doc.setCreationDate(date);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(regular.getCharacterSet());
  /** Standard fonts only cover WinAnsi; anything else (emoji, CJK) would throw. */
  const clean = (t: string) => Array.from(t.replace(/\r/g, '').replace(/\t/g, ' '), (c) => (c === '\n' || charset.has(c.codePointAt(0)!) ? c : '?')).join('');

  let logo: PDFImage | null = null;
  if (input.logoPng) { try { logo = await doc.embedPng(input.logoPng); } catch { logo = null; } }

  let page!: PDFPage;
  let y = 0;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const ensure = (h: number) => { if (y - h < M + FOOTER_H) { newPage(); y -= 4; } };

  const text = (t: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(clean(t), { x, y: yy, size: o.size ?? 10, font: o.font ?? regular, color: o.color ?? INK });

  /** Word-wraps (and hard-breaks long file names) to the width. */
  const wrap = (t: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of clean(t).split('\n')) {
      let line = '';
      for (let word of para.split(/ +/)) {
        while (font.widthOfTextAtSize(word, size) > width) {
          let i = word.length - 1;
          while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > width) i--;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, i));
          word = word.slice(i);
        }
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out;
  };

  const paragraph = (t: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) => {
    const size = o.size ?? 10, font = o.font ?? regular, lh = size * 1.4;
    for (const line of wrap(t, font, size, o.width ?? CONTENT_W)) {
      ensure(lh);
      text(line, o.x ?? M, y - size, { size, font, color: o.color });
      y -= lh;
    }
    y -= o.gap ?? 0;
  };

  const heading = (t: string) => {
    ensure(34);
    y -= 10;
    text(t.toUpperCase(), M, y - 9, { size: 9, font: bold, color: ACCENT });
    y -= 15;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: LINE });
    y -= 8;
  };

  /** Label / value rows; values wrap. */
  const rows = (list: [string, string][], labelW = 110) => {
    for (const [k, v] of list) {
      const lines = wrap(v || '—', regular, 10, CONTENT_W - labelW);
      ensure(Math.min(lines.length, 3) * 14 + 2);
      text(k, M, y - 10, { size: 9, color: MUTED });
      for (const line of lines) { ensure(14); text(line, M + labelW, y - 10); y -= 14; }
      y -= 2;
    }
  };

  /** A table with a shaded header row; rows split onto a new page (with the header again). */
  const grid = (cols: { h: string; w: number }[], list: string[][]) => {
    const size = 8.5, lh = 11, pad = 5;
    const head = () => {
      ensure(lh + pad * 2 + 20);
      page.drawRectangle({ x: M, y: y - lh - pad * 2, width: CONTENT_W, height: lh + pad * 2, color: SOFT });
      let x = M;
      for (const c of cols) { text(c.h, x + pad, y - pad - size, { size, font: bold, color: MUTED }); x += c.w; }
      y -= lh + pad * 2;
    };
    head();
    for (const row of list) {
      const cells = row.map((v, i) => wrap(v, regular, size, cols[i].w - pad * 2));
      const h = Math.max(...cells.map((c) => c.length)) * lh + pad * 2;
      if (y - h < M + FOOTER_H) { newPage(); head(); }
      let x = M;
      cells.forEach((lines, i) => { lines.forEach((line, j) => text(line, x + pad, y - pad - size - j * lh, { size })); x += cols[i].w; });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    }
    y -= 6;
  };
  const COLS = [
    { h: 'Location', w: 72 }, { h: 'Decoration', w: 78 }, { h: 'File', w: 104 },
    { h: 'Size', w: 62 }, { h: 'Position', w: 112 }, { h: 'Notes', w: 88 },
  ];
  const table = (list: Placement[]) => grid(COLS, list.map((p) => [p.location, p.decoration, p.file ?? '—', placementSize(p), placementPosition(p), p.notes ?? '']));

  /** A mockup image in a bordered box of at most `maxH` points, or a note when images are left out. */
  const mockupBox = (img: PDFImage | null, maxH: number) => {
    if (!img) { paragraph('The mockup image is attached to the email as a PNG.', { color: MUTED, gap: 6 }); return; }
    const boxH = maxH;
    const scale = Math.min(CONTENT_W / img.width, boxH / img.height, 1.5);
    const w = img.width * scale, h = img.height * scale;
    page.drawRectangle({ x: M, y: y - boxH, width: CONTENT_W, height: boxH, borderColor: LINE, borderWidth: 0.75, color: rgb(1, 1, 1) });
    page.drawImage(img, { x: M + (CONTENT_W - w) / 2, y: y - boxH + (boxH - h) / 2, width: w, height: h });
    y -= boxH + 8;
  };
  const embed = async (m: PdfMockup) => { if (!withImages) return null; try { return await doc.embedPng(m.png); } catch { return null; } };
  const sideTitle = (label: string) => label.replace(/^.*Mockup:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase());
  const items = input.items ?? [];

  // ── (a) Summary ────────────────────────────────────────────────────────────
  newPage();
  const logoSize = 46;
  if (logo) page.drawImage(logo, { x: M - 4, y: y - logoSize + 4, width: logoSize, height: logoSize });
  const tx = logo ? M + logoSize + 6 : M;
  text(`${business.shortName} · ${business.name}`, tx, y - 16, { size: 15, font: bold });
  text('Design Request Summary', tx, y - 33, { size: 11, color: MUTED });
  const rightText = (t: string, yy: number, size: number, font = regular, color = INK) =>
    text(t, W - M - font.widthOfTextAtSize(clean(t), size), yy, { size, font, color });
  rightText('Request number', y - 10, 8, regular, MUTED);
  rightText(ref, y - 24, 12, bold, ACCENT);
  rightText(formatRequestDate(date), y - 38, 8.5, regular, MUTED);
  y -= logoSize + 10;

  // Contact block in a soft panel.
  const a = business.address;
  const contact = [
    `${business.phoneDisplay}  ·  ${business.email}  ·  ${business.url.replace(/^https:\/\//, '')}`,
    `Production in ${business.serviceAreas.join(' and ')}`,
    `${a.streetAddress}, ${a.addressLocality}, ${a.addressRegion} ${a.postalCode}  ·  ${HOURS}`,
  ];
  const panelH = contact.length * 13 + 14;
  page.drawRectangle({ x: M, y: y - panelH, width: CONTENT_W, height: panelH, color: SOFT });
  contact.forEach((line, i) => text(line, M + 10, y - 17 - i * 13, { size: 9, font: i === 0 ? bold : regular, color: i === 0 ? INK : MUTED }));
  y -= panelH + 4;

  heading('Customer');
  rows([
    ['Name', q.name], ['Company', q.company ?? '—'], ['Email', q.email], ['Phone', q.phone ?? '—'],
  ]);

  heading('Order');
  const tier = turnaroundTier(q.turnaround);
  rows([
    ['Garment', items.length ? `${q.garment} (${items.length} product${items.length === 1 ? '' : 's'})` : q.garment],
    ['Quantity', `${q.quantity} pieces`],
    ['Decoration', q.decorations.join(', ') || 'Not sure yet'],
    ['Turnaround', turnaroundLine(q.turnaround) + (tier.id === 'super-rush' ? `\n${business.superRushNote}` : '')],
    ['Needed by', formatNeededBy(q.deadline) || 'No date given'],
    ...(items.length ? [
      ['Artwork files', `${items.reduce((n, it) => n + it.artworkNames.length, 0) || 'None'} attached (listed per product)`] as [string, string],
    ] : [
      ['Artwork files', artworkNames.length ? artworkNames.join(', ') : 'None attached'] as [string, string],
      ['Placements', placements.length ? `${placements.length} (see ${mockups.length ? 'mockup pages' : 'placement table'})` : 'None placed'] as [string, string],
    ]),
  ]);

  if (items.length) {
    heading(`Products (${items.length})`);
    grid(
      [{ h: '#', w: 22 }, { h: 'Product', w: 170 }, { h: 'Color', w: 80 }, { h: 'Sizes', w: 140 }, { h: 'Qty', w: 34 }, { h: 'Decoration', w: 70 }],
      items.map(({ item: it }, i) => [
        String(i + 1), [it.productName, [it.brand, it.style].filter(Boolean).join(' ')].filter(Boolean).join('\n'), it.color || '—',
        sizesText(it.sizes) || '—', String(it.quantity),
        [...new Set([...it.decorations, ...it.placements.map((p) => p.decoration)])].join(', ') || '—',
      ]),
    );
  }

  if (q.details) {
    heading('Product details');
    paragraph(q.details, { size: 9.5 });
  }

  const aboutMockup = () => {
    heading('About your mockup');
    ABOUT_MOCKUP.forEach((p) => paragraph(p, { size: 9, color: MUTED, gap: 4 }));
  };
  // Cart PDFs put it after the products, so the summary stays on one page.
  if (!items.length) aboutMockup();

  // ── Quote cart: one section per product, with its mockups and placements ──
  for (const [i, { item: it, artworkNames: names, mockups: ms }] of items.entries()) {
    newPage();
    text(`Product ${i + 1} of ${items.length}`, M, y - 9, { size: 9, font: bold, color: ACCENT });
    rightText(ref, y - 9, 10, bold, ACCENT);
    y -= 14;
    for (const line of wrap(it.productName, bold, 16, CONTENT_W)) { text(line, M, y - 16, { size: 16, font: bold }); y -= 20; }
    y -= 4;
    rows([
      ['Brand / style', [it.brand, it.style && `Style ${it.style}`].filter(Boolean).join(' · ') || '—'],
      ['Color', it.color || '—'],
      ['Sizes', sizesText(it.sizes) || '—'],
      ['Quantity', `${it.quantity} pieces`],
      ['Decoration', [...new Set([...it.decorations, ...it.placements.map((p) => p.decoration)])].join(', ') || 'Not sure yet'],
      ['Print locations', (it.locations.length ? it.locations : it.placements.map((p) => p.location)).join(', ') || '—'],
      ['Artwork files', names.length ? names.join(', ') : 'None attached'],
    ]);
    const shown = new Set<Placement>();
    for (const m of ms) {
      const side = it.placements.filter((p) => placementSide(p) === m.side);
      side.forEach((p) => shown.add(p));
      const tableH = side.length ? 40 + side.length * 34 : 0;
      const img = await embed(m);
      // Room for a useful image plus its table on this page, else a fresh page.
      if (img && y - M - FOOTER_H - tableH < 250) {
        newPage();
        text(`Product ${i + 1} of ${items.length} · ${it.productName} (continued)`, M, y - 9, { size: 9, font: bold, color: MUTED });
        rightText(ref, y - 9, 10, bold, ACCENT);
        y -= 16;
      }
      heading(`${sideTitle(m.label)} mockup`);
      mockupBox(img, Math.max(200, Math.min(380, y - M - FOOTER_H - tableH - 10)));
      if (side.length) table(side);
    }
    const rest = it.placements.filter((p) => !shown.has(p));
    if (rest.length) {
      heading(ms.length ? 'Other placements' : 'Artwork placements');
      table(rest);
    }
  }

  if (items.length) aboutMockup();

  // ── (b) One page per mockup, with that side's placements ─────────────────
  const covered = new Set<Placement>();
  for (const m of mockups) {
    newPage();
    text(m.label.replace(/^Mockup:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase()) + ' mockup', M, y - 16, { size: 16, font: bold });
    rightText(ref, y - 14, 10, bold, ACCENT);
    y -= 30;
    const sidePlacements = placements.filter((p) => placementSide(p) === m.side);
    sidePlacements.forEach((p) => covered.add(p));
    let img: PDFImage | null = null;
    if (withImages) { try { img = await doc.embedPng(m.png); } catch { img = null; } }
    const tableEstimate = sidePlacements.length ? 30 + sidePlacements.length * 34 : 0;
    const boxH = Math.max(220, Math.min(470, y - M - FOOTER_H - tableEstimate - 10));
    if (img) {
      const scale = Math.min(CONTENT_W / img.width, boxH / img.height, 1.5);
      const w = img.width * scale, h = img.height * scale;
      page.drawRectangle({ x: M, y: y - boxH, width: CONTENT_W, height: boxH, borderColor: LINE, borderWidth: 0.75, color: rgb(1, 1, 1) });
      page.drawImage(img, { x: M + (CONTENT_W - w) / 2, y: y - boxH + (boxH - h) / 2, width: w, height: h });
      y -= boxH + 8;
    } else {
      paragraph('The mockup image is attached to the email as a PNG.', { color: MUTED, gap: 6 });
    }
    if (sidePlacements.length) {
      heading(`Placements on the ${m.side}`);
      table(sidePlacements);
    }
  }

  // ── (c) Placements not shown on any mockup ───────────────────────────────
  const rest = placements.filter((p) => !covered.has(p));
  if (rest.length) {
    newPage();
    text(mockups.length ? 'Other placements' : 'Artwork placements', M, y - 16, { size: 16, font: bold });
    rightText(ref, y - 14, 10, bold, ACCENT);
    y -= 26;
    paragraph('Approximate sizes and positions, measured from the top center of each print area.', { size: 9, color: MUTED, gap: 4 });
    table(rest);
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    p.drawLine({ start: { x: M, y: M + 26 }, end: { x: W - M, y: M + 26 }, thickness: 0.5, color: LINE });
    text(MOCKUP_DISCLAIMER, M, M + 12, { size: 7.5, color: MUTED });
    text(`${business.shortName} · ${ref}`, M, M, { size: 7.5, color: MUTED });
    const label = `Page ${i + 1} of ${pages.length}`;
    text(label, W - M - regular.widthOfTextAtSize(label, 7.5), M, { size: 7.5, color: MUTED });
  });

  return doc.save();
}
