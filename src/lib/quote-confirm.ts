// Confirmation email sent to the customer after a quote / design request.
// Table layout with inline styles so it holds up in Gmail and Outlook.
import { business } from '../data/business';
import { esc, turnaroundTier, type QuoteRequest } from './quote';
import { HOURS, MOCKUP_DISCLAIMER, formatNeededBy, turnaroundLine } from './quote-pdf';

const LOGO = `${business.url}/icon-512.png`;
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function confirmationEmail(q: QuoteRequest, ref: string, mockups: { cid: string; label: string }[] = [], logoUrl = LOGO) {
  const first = q.name.split(/\s+/)[0] || q.name;
  const tier = turnaroundTier(q.turnaround);
  const summary: [string, string][] = [
    ['Request number', ref],
    ['Product', q.garment],
    ['Quantity', `${q.quantity} pieces`],
    ['Decoration', q.decorations.join(', ') || 'Not sure yet'],
    ['Turnaround', turnaroundLine(q.turnaround)],
    ...(q.deadline ? [['Needed by', formatNeededBy(q.deadline)] as [string, string]] : []),
  ];
  const steps = [
    'We review your artwork and details, then reply with a quote within one business day.',
    'Once you approve the quote, we send a digital proof with the final print size, placement and colors.',
    'Production starts only after you approve the proof.',
  ];
  const subject = `We got your request · ${ref} · ${business.shortName}`;

  const text = [
    `Thanks, ${first}!`,
    '',
    `We got your request. Your request number is ${ref}.`,
    '',
    ...summary.map(([k, v]) => `${k}: ${v}`),
    ...(tier.id === 'super-rush' ? [`(${business.superRushNote})`] : []),
    ...(q.details ? ['', 'Details:', q.details] : []),
    '',
    'What happens next',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    MOCKUP_DISCLAIMER,
    'Your Design Request Summary (PDF) is attached.',
    '',
    `Questions? Reply to this email or call ${business.phoneDisplay}.`,
    `${business.name} · ${business.email} · ${HOURS}`,
    business.url,
  ].join('\n');

  const cell = `${FONT};font-size:14px;line-height:20px;color:#18181b`;
  const muted = `${FONT};font-size:13px;line-height:19px;color:#71717a`;
  const rowsHtml = summary.map(([k, v], i) => `<tr>
<td style="${muted};padding:8px 12px 8px 0;border-top:${i ? '1px solid #e4e4e7' : '0'};width:130px;vertical-align:top">${esc(k)}</td>
<td style="${cell};padding:8px 0;border-top:${i ? '1px solid #e4e4e7' : '0'};font-weight:${i ? 600 : 700};${i ? '' : 'color:#6d28d9;'}vertical-align:top">${esc(v)}${i === 4 && tier.id === 'super-rush' ? `<br><span style="${muted};font-weight:400">${esc(business.superRushNote)}</span>` : ''}</td>
</tr>`).join('');
  const mockupHtml = mockups.length
    ? `<tr><td style="padding:8px 32px 0">${mockups.map((m) => `<p style="${muted};margin:16px 0 6px;font-weight:600">${esc(m.label.replace(/^Mockup:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase()))}</p><img src="cid:${m.cid}" alt="${esc(m.label)}" width="480" style="display:block;width:100%;max-width:480px;height:auto;border:1px solid #e4e4e7;border-radius:10px">`).join('')}
<p style="${muted};margin:10px 0 0;font-size:12px">${esc(MOCKUP_DISCLAIMER)}</p></td></tr>`
    : '';
  const stepsHtml = steps.map((s, i) => `<tr>
<td style="padding:6px 12px 6px 0;vertical-align:top;width:28px"><div style="${FONT};width:24px;height:24px;line-height:24px;border-radius:12px;background:#ede9fe;color:#6d28d9;font-size:12px;font-weight:700;text-align:center">${i + 1}</div></td>
<td style="${cell};padding:8px 0;vertical-align:top">${esc(s)}</td></tr>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<div style="display:none;max-height:0;overflow:hidden">Your request number is ${esc(ref)}. We reply with a quote within one business day.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e4e4e7;border-radius:14px">
<tr><td style="padding:24px 32px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle;padding-right:10px"><img src="${esc(logoUrl)}" width="44" height="44" alt="${esc(business.shortName)}" style="display:block;border:0"></td>
    <td style="vertical-align:middle;${FONT};font-size:16px;line-height:20px;font-weight:700;color:#18181b">${esc(business.shortName)}<span style="font-weight:400;color:#71717a"> · ${esc(business.name)}</span></td>
  </tr></table>
</td></tr>
<tr><td style="padding:16px 32px 0">
  <h1 style="${FONT};margin:0;font-size:24px;line-height:30px;color:#18181b">Thanks, ${esc(first)}! We got your request.</h1>
  <p style="${cell};margin:10px 0 0">Your request number is <b style="color:#6d28d9">${esc(ref)}</b>. Keep it handy if you call or email us about this order.</p>
</td></tr>
<tr><td style="padding:20px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px"><tr><td style="padding:8px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>
  </td></tr></table>
</td></tr>
${mockupHtml}
<tr><td style="padding:24px 32px 0">
  <h2 style="${FONT};margin:0 0 6px;font-size:17px;line-height:24px;color:#18181b">What happens next</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stepsHtml}</table>
  <p style="${muted};margin:12px 0 0">Your Design Request Summary is attached as a PDF.</p>${mockups.length ? '' : `<p style="${muted};margin:6px 0 0;font-size:12px">${esc(MOCKUP_DISCLAIMER)}</p>`}
</td></tr>
<tr><td style="padding:24px 32px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e4e4e7"><tr><td style="padding-top:16px">
  <p style="${cell};margin:0 0 4px">Questions? Just reply to this email or call <a href="tel:${esc(business.phone)}" style="color:#6d28d9;font-weight:600;text-decoration:none">${esc(business.phoneDisplay)}</a>.</p>
  <p style="${muted};margin:0"><a href="mailto:${esc(business.email)}" style="color:#71717a">${esc(business.email)}</a> · ${esc(HOURS)}</p>
  <p style="${muted};margin:4px 0 0"><a href="${esc(business.url)}" style="color:#71717a">${esc(business.url.replace(/^https:\/\//, ''))}</a> · Production in ${esc(business.serviceAreas.join(' and '))}</p>
  </td></tr></table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
