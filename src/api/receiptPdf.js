// Payment receipts as PDF (A5 portrait). jsPDF and the embedded fonts (Inter + Fraunces, with a real ₹)
// load only when a receipt is generated, so they never slow down the rest of the app.
import { native } from '../platform/native.js';

const C = {
  teal: [29, 84, 112],
  tealDark: [11, 42, 58],
  tealSoft: [232, 240, 243],
  sand: [201, 191, 158],
  sandSoft: [247, 243, 233],
  ink: [17, 48, 63],
  body: [55, 72, 80],
  muted: [110, 125, 132],
  line: [226, 220, 204],
  green: [36, 122, 90],
  greenSoft: [222, 241, 233],
  amber: [176, 104, 20],
  amberSoft: [252, 238, 216],
  rose: [192, 57, 57],
  roseSoft: [251, 228, 228],
  white: [255, 255, 255],
};

const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer' };
const inr = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const day = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const stamp = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// "Rupees One Thousand Two Hundred Only" (Indian numbering: thousand, lakh, crore).
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}
export function rupeesInWords(amount) {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Rupees Zero Only';
  const parts = [];
  for (const [size, name] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']]) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  return `Rupees ${parts.join(' ')} Only`;
}

// The Knowledge Nest mark, rasterised from the same shapes as the in-app logo.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="240" height="240">
<rect width="48" height="48" rx="12" fill="#c9bf9e"/>
<path d="M24 4.2q.7 3.1 3.6 3.8-2.9.7-3.6 3.8-.7-3.1-3.6-3.8 2.9-.7 3.6-3.8Z" fill="#1d5470"/>
<path d="M23.2 28.5C19.5 24.8 14.6 22.7 9.6 22.9l1.6-10.6c5-.2 9.6 2 12 5.6Z" fill="#1d5470"/>
<path d="M24.8 28.5c3.7-3.7 8.6-5.8 13.6-5.6l-1.6-10.6c-5-.2-9.6 2-12 5.6Z" fill="#1d5470"/>
<path d="M6.5 25.8Q24 31.5 41.5 25.8C40.6 35 33.4 41 24 41S7.4 35 6.5 25.8Z" fill="#1d5470" stroke="#c9bf9e" stroke-width="2.4" paint-order="stroke"/>
<g fill="none" stroke="#c9bf9e" stroke-width="1.3" stroke-linecap="round"><path d="M8.3 29.4Q24 34.6 39.7 29.4M11.6 35.2Q24 39.2 36.4 35.2"/></g>
</svg>`;

let logoPromise = null;
function logoPng() {
  logoPromise ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 240;
      c.getContext('2d').drawImage(img, 0, 0, 240, 240);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;
  });
  return logoPromise;
}

async function newDoc() {
  const [{ jsPDF }, { default: fonts }, logo] = await Promise.all([import('jspdf'), import('./pdfFonts.js'), logoPng()]);
  const doc = new jsPDF({ unit: 'mm', format: 'a5', compress: true });
  for (const [name, family, style] of [
    ['Inter-Regular', 'Inter', 'normal'],
    ['Inter-SemiBold', 'InterSemi', 'normal'],
    ['Inter-Bold', 'Inter', 'bold'],
    ['Fraunces-SemiBold', 'Fraunces', 'normal'],
  ]) {
    doc.addFileToVFS(`${name}.ttf`, fonts[name]);
    doc.addFont(`${name}.ttf`, family, style);
  }
  return { doc, logo };
}

/**
 * Round rubber-stamp seal: organisation name around the ring, status word and date in the middle,
 * tilted by `tilt` degrees like a hand stamp.
 */
function drawStamp(doc, { cx, cy, r, word, date: dateText, color, tilt = -12 }) {
  const rot = (tilt * Math.PI) / 180;
  // rotate a point (dx, dy) relative to the centre by the tilt
  const at = (dx, dy) => [cx + dx * Math.cos(rot) - dy * Math.sin(rot), cy + dx * Math.sin(rot) + dy * Math.cos(rot)];

  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.88 }));
  doc.setDrawColor(...color);
  doc.setTextColor(...color);

  doc.setLineWidth(0.9);
  doc.circle(cx, cy, r, 'S');
  doc.setLineWidth(0.35);
  doc.circle(cx, cy, r - 1.6, 'S');
  doc.circle(cx, cy, r * 0.66, 'S');

  // Ring text, spread evenly around the full circle, reading clockwise.
  const ring = 'KNOWLEDGE NEST • READING ROOM • ';
  doc.setFont('Inter', 'bold');
  doc.setFontSize(6.4);
  const baseR = r * 0.66 + 1.25; // baseline just outside the inner circle; letters grow outward
  const widths = [...ring].map((ch) => doc.getTextWidth(ch));
  const gap = (2 * Math.PI * baseR - widths.reduce((a, b) => a + b, 0)) / ring.length;
  let phi = -Math.PI / 2 + rot - (widths[0] + gap) * 2.4 / baseR; // start a little left of the top
  [...ring].forEach((ch, i) => {
    const mid = phi + (widths[i] / 2) / baseR;
    const px = cx + baseR * Math.cos(mid);
    const py = cy + baseR * Math.sin(mid);
    // shift back along the tangent by half the glyph so it's centred on its slot
    const sx = px + Math.sin(mid) * (widths[i] / 2);
    const sy = py - Math.cos(mid) * (widths[i] / 2);
    if (ch.trim()) doc.text(ch, sx, sy, { angle: -((mid * 180) / Math.PI + 90) });
    phi += (widths[i] + gap) / baseR;
  });

  // Centre: status word with a rule above and below, then the date.
  const centred = (text, size, dy, style = 'bold') => {
    doc.setFont('Inter', style);
    doc.setFontSize(size);
    const w = doc.getTextWidth(text);
    const [x, y] = at(-w / 2, dy);
    doc.text(text, x, y, { angle: -tilt });
  };
  centred(word, word.length > 6 ? 6.6 : 8.6, 1.1);
  doc.setLineWidth(0.3);
  for (const dy of [-3.4, 2.6]) {
    const [x1, y1] = at(-r * 0.46, dy);
    const [x2, y2] = at(r * 0.46, dy);
    doc.line(x1, y1, x2, y2);
  }
  centred(dateText.toUpperCase(), 4.6, 5.3, 'normal');
  doc.restoreGraphicsState();
}

/**
 * Build the receipt. `shift` is { label, time } for the booking's shift.
 * Account figures (paid before / balance after) are as of this payment, not as of today.
 */
export async function buildReceiptPdf(p, shift = {}) {
  const { doc, logo } = await newDoc();
  const W = doc.internal.pageSize.getWidth(); // 148
  const H = doc.internal.pageSize.getHeight(); // 210
  const M = 11;
  const IW = W - M * 2;
  const refund = p.kind === 'refund';
  const voided = !!p.voidedAt;
  const dayPass = p.bookingKind === 'day';

  // --- small drawing helpers ---
  const font = (family, size, color = C.ink, style = 'normal') => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const label = (text, x, y, color = C.teal, align = 'left') => {
    font('Inter', 6.3, color, 'bold');
    doc.text(text.toUpperCase(), x, y, { charSpace: 0.45, align });
  };
  const fill = (color) => doc.setFillColor(...color);
  const stroke = (color, w = 0.25) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(w);
  };

  doc.setProperties({
    title: `Knowledge Nest ${refund ? 'refund' : 'payment'} receipt ${p.receiptNo}`,
    subject: `${refund ? 'Refund' : 'Payment'} of ${inr(p.amount)} for seat ${p.seatLabel}`,
    author: 'Knowledge Nest Reading Room',
    creator: 'Knowledge Nest admin console',
  });

  // ===== Header =====
  fill(C.tealDark);
  doc.rect(0, 0, W, 32, 'F');
  fill(C.teal);
  doc.rect(0, 0, W * 0.64, 32, 'F');
  fill(C.sand);
  doc.rect(0, 32, W, 1.2, 'F');
  if (logo) doc.addImage(logo, 'PNG', M, 7.5, 17, 17);
  font('Fraunces', 17.5, C.white);
  doc.text('Knowledge Nest', M + 21.5, 16.2);
  label('Reading Room', M + 21.5, 21.6, C.sand);
  label(refund ? 'Refund receipt' : 'Payment receipt', W - M, 11.5, C.sand, 'right');
  font('Inter', 13.5, C.white, 'bold');
  doc.text(p.receiptNo, W - M, 18.6, { align: 'right' });
  font('Inter', 8, [205, 220, 226]);
  doc.text(day(p.paidOn), W - M, 24.2, { align: 'right' });

  // ===== Title + status =====
  let y = 45;
  font('Fraunces', 15, C.ink);
  doc.text(refund ? 'Refund receipt' : 'Payment receipt', M, y);

  const fee = p.bookingFee ?? 0;
  const before = p.paidBefore ?? 0;
  const after = before + (refund ? -p.amount : p.amount);
  const balanceAfter = Math.max(fee - after, 0);
  const status = voided
    ? { text: 'VOID', fg: C.rose, bg: C.roseSoft }
    : refund
      ? { text: 'REFUNDED', fg: C.rose, bg: C.roseSoft }
      : balanceAfter > 0
        ? { text: 'PART-PAID', fg: C.amber, bg: C.amberSoft }
        : { text: 'PAID IN FULL', fg: C.green, bg: C.greenSoft };
  font('Inter', 7.2, status.fg, 'bold');
  const sw = doc.getTextWidth(status.text) + status.text.length * 0.45 + 8;
  fill(status.bg);
  doc.roundedRect(W - M - sw, y - 5.2, sw, 7.4, 3.7, 3.7, 'F');
  doc.text(status.text, W - M - sw / 2, y - 0.3, { align: 'center', charSpace: 0.45 });
  if (voided) {
    y += 5.5;
    font('InterSemi', 8, C.rose);
    doc.text(doc.splitTextToSize(`Voided${p.voidReason ? `: ${p.voidReason}` : ''}. This receipt is no longer valid.`, IW)[0], M, y);
  }

  // ===== Received from / For =====
  y += 6;
  const cardW = (IW - 4) / 2;
  const cardH = 25;
  const card = (x, title, lines) => {
    fill(C.sandSoft);
    stroke(C.line);
    doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'FD');
    label(title, x + 4.5, y + 5.8);
    font('InterSemi', 10.5, C.ink);
    doc.text(doc.splitTextToSize(lines[0], cardW - 9)[0], x + 4.5, y + 11.8);
    font('Inter', 8, C.body);
    lines.slice(1).forEach((t, i) => t && doc.text(doc.splitTextToSize(t, cardW - 9)[0], x + 4.5, y + 16.6 + i * 4.4));
  };
  card(M, refund ? 'Refunded to' : 'Received from', [
    p.memberName,
    [p.memberCode, p.memberPhone].filter(Boolean).join('  ·  ') || (dayPass ? 'Walk-in guest' : ''),
  ]);
  card(M + cardW + 4, 'For', dayPass
    ? [`Seat ${p.seatLabel}  ·  Day pass`, shift.time ? `Whole day ${shift.time}` : 'Whole day', day(p.startDate)]
    : [
        `Seat ${p.seatLabel}  ·  ${shift.label ?? p.shift}`,
        shift.time ? `Shift ${shift.time}` : '',
        `${day(p.startDate)} – ${day(p.endDate)}`,
      ]);

  // ===== Account table =====
  y += cardH + 8;
  label(dayPass ? 'Day pass account' : 'Plan account', M, y);
  y += 3;
  const rowH = 7.2;
  const col2 = W - M - 4;
  const tableRow = (text, value, { bold = false, highlight = false, color = C.ink, sub = '' } = {}) => {
    if (highlight) {
      fill(C.tealSoft);
      doc.rect(M, y, IW, rowH, 'F');
    }
    font(bold ? 'InterSemi' : 'Inter', 8.8, bold ? C.ink : C.body);
    doc.text(text, M + 4, y + 4.8);
    if (sub) {
      const tw = doc.getTextWidth(text);
      font('Inter', 7.2, C.muted);
      doc.text(sub, M + 4 + tw + 2.5, y + 4.8);
    }
    font(bold ? 'Inter' : 'Inter', 8.8, color, bold ? 'bold' : 'normal');
    doc.text(value, col2, y + 4.8, { align: 'right' });
    y += rowH;
    stroke(C.line);
    doc.line(M, y, W - M, y);
  };
  stroke(C.line);
  doc.line(M, y, W - M, y);
  tableRow(dayPass ? 'Day pass fee' : 'Plan fee', inr(fee));
  tableRow(refund ? 'Paid before this refund' : 'Paid before this receipt', inr(before));
  tableRow(refund ? 'This refund' : 'This payment', `${refund ? '− ' : ''}${inr(p.amount)}`, {
    bold: true,
    highlight: true,
    color: refund ? C.rose : C.teal,
  });
  if (refund) {
    tableRow('Net paid after this refund', inr(after), { bold: true });
  } else {
    tableRow('Balance due after this payment', inr(balanceAfter), {
      bold: true,
      color: balanceAfter > 0 ? C.amber : C.green,
    });
  }

  // ===== Amount panel =====
  y += 6;
  const panelH = 21;
  fill(C.tealDark);
  doc.roundedRect(M, y, IW, panelH, 3, 3, 'F');
  label(refund ? 'Amount refunded' : 'Amount received', M + 5, y + 7, C.sand);
  font('Inter', 7.6, [205, 220, 226]);
  doc.text(doc.splitTextToSize(rupeesInWords(p.amount), IW - 62), M + 5, y + 12.4);
  font('Inter', 21, C.white, 'bold');
  doc.text(inr(p.amount), W - M - 5, y + 13.6, { align: 'right' });

  // ===== Payment details =====
  y += panelH + 7;
  label(refund ? 'Refund details' : 'Payment details', M, y);
  y += 2.5;
  const details = [
    ['Method', METHOD[p.method] ?? p.method],
    p.reference && [p.method === 'upi' ? 'UPI transaction ID' : 'Reference', p.reference],
    [refund ? 'Refund date' : 'Payment date', day(p.paidOn)],
    ['Recorded on', p.createdAt ? stamp(p.createdAt) : '—'],
    [refund ? 'Refunded by' : 'Received by', p.receivedBy ?? 'Online payment'],
  ].filter(Boolean);
  // Leave the right-hand ~34 mm free for the stamp so long values never run into it.
  const colW = voided ? IW / 2 : (IW - 34) / 2;
  details.forEach(([k, v], i) => {
    const x = M + (i % 2) * colW;
    const yy = y + Math.floor(i / 2) * 10;
    font('Inter', 7, C.muted);
    doc.text(k, x, yy + 4.5);
    font('InterSemi', 9, C.ink);
    doc.text(doc.splitTextToSize(String(v), colW - 4)[0], x, yy + 9);
  });
  y += Math.ceil(details.length / 2) * 10 + 4;

  if (p.notes) {
    font('Inter', 7.6, C.body);
    doc.text(doc.splitTextToSize(`Note: ${p.notes}`, IW)[0], M, y + 1);
    y += 5;
  }

  // ===== Organisation stamp (bottom-right white space, beside the payment details) =====
  if (!voided) {
    drawStamp(doc, {
      cx: W - M - 15.5,
      cy: H - 19 - 17.5,
      r: 14,
      word: refund ? 'REFUNDED' : 'PAID',
      date: day(p.paidOn),
      color: refund ? C.rose : C.teal,
    });
  }

  // ===== VOID watermark =====
  if (voided) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.12 }));
    font('Inter', 78, C.rose, 'bold');
    doc.text('VOID', W / 2, H / 2 + 10, { align: 'center', angle: 28 });
    doc.restoreGraphicsState();
  }

  // ===== Footer =====
  fill(C.sandSoft);
  doc.rect(0, H - 19, W, 19, 'F');
  fill(C.sand);
  doc.rect(0, H - 19, W, 0.8, 'F');
  font('Fraunces', 10.5, C.tealDark);
  doc.text('Thank you for studying with us.', W / 2, H - 11.2, { align: 'center' });
  font('Inter', 6.6, C.muted);
  doc.text(
    `Computer-generated receipt, no signature required  ·  Generated ${stamp(new Date().toISOString())}`,
    W / 2,
    H - 6,
    { align: 'center' }
  );

  return doc;
}

const fileName = (p) => `Knowledge-Nest-${p.receiptNo}.pdf`;

// Blob URLs for on-screen previews, cached per receipt so hovering again is instant.
const previewCache = new Map();
export function receiptPreviewUrl(p, shift) {
  const key = `${p.id}:${p.voidedAt ?? ''}`;
  if (!previewCache.has(key)) {
    previewCache.set(
      key,
      buildReceiptPdf(p, shift)
        .then((doc) => URL.createObjectURL(doc.output('blob')))
        .catch((err) => {
          previewCache.delete(key);
          throw err;
        })
    );
  }
  return previewCache.get(key);
}

const PDF = 'application/pdf';

export async function downloadReceiptPdf(p, shift) {
  const doc = await buildReceiptPdf(p, shift);
  // Android app: save to the phone's Documents folder and open it.
  if (native) return native.openFile(await native.saveFile(doc.output('blob'), fileName(p), PDF, 'documents'), PDF);
  doc.save(fileName(p));
}

// Opens the PDF in a new tab. The tab is opened first, synchronously, so pop-up blockers allow it.
export async function previewReceiptPdf(p, shift) {
  if (native) {
    const blob = (await buildReceiptPdf(p, shift)).output('blob');
    return native.openFile(await native.saveFile(blob, fileName(p), PDF, 'cache'), PDF);
  }
  const tab = window.open('', '_blank');
  const url = URL.createObjectURL((await buildReceiptPdf(p, shift)).output('blob'));
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const canSharePdf = () => !!native || (typeof navigator !== 'undefined' && !!navigator.canShare);

// Phones: hand the PDF to WhatsApp, email, etc. through the system share sheet.
export async function shareReceiptPdf(p, shift) {
  const blob = (await buildReceiptPdf(p, shift)).output('blob');
  if (native) {
    await native.shareFile(await native.saveFile(blob, fileName(p), PDF, 'cache'), `Receipt ${p.receiptNo}`, `Knowledge Nest receipt ${p.receiptNo}`);
    return true;
  }
  const file = new File([blob], fileName(p), { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `Receipt ${p.receiptNo}`, text: `Knowledge Nest receipt ${p.receiptNo}` });
    return true;
  }
  return false;
}
