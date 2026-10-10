// Branded email HTML, shared by the live preview (browser) and the send route (server).
// Table layout + inline styles so it renders in Gmail, Outlook and Apple Mail.

export interface EmailBranding {
  logoUrl: string;
  logoWidth: number;          // px
  align: 'left' | 'center';
  fontFamily: string;         // one of FONTS keys
  fallbackFont: string;       // one of SAFE_FONTS: used by Gmail/Outlook when a web font is chosen
  fontSize: number;           // px
  textColor: string;
  accentColor: string;        // header bar, links
  backgroundColor: string;    // page
  cardColor: string;          // email body
  signature: string;          // supports {{sender_name}}, {{first_name}}, {{company}}
  companyName: string;
  address: string;
  phone: string;
  website: string;
  footerNote: string;
  facebook: string;
  instagram: string;
  linkedin: string;
}

export const FONTS: Record<string, { stack: string; google?: string }> = {
  Arial: { stack: 'Arial, Helvetica, sans-serif' },
  Helvetica: { stack: 'Helvetica, Arial, sans-serif' },
  Verdana: { stack: 'Verdana, Geneva, sans-serif' },
  Tahoma: { stack: 'Tahoma, Verdana, sans-serif' },
  'Trebuchet MS': { stack: '"Trebuchet MS", Helvetica, sans-serif' },
  Georgia: { stack: 'Georgia, "Times New Roman", serif' },
  'Times New Roman': { stack: '"Times New Roman", Times, serif' },
  Poppins: { stack: 'Poppins, Arial, sans-serif', google: 'Poppins:wght@400;600' },
  Inter: { stack: 'Inter, Arial, sans-serif', google: 'Inter:wght@400;600' },
  Roboto: { stack: 'Roboto, Arial, sans-serif', google: 'Roboto:wght@400;700' },
  'Open Sans': { stack: '"Open Sans", Arial, sans-serif', google: 'Open+Sans:wght@400;600' },
  Lato: { stack: 'Lato, Arial, sans-serif', google: 'Lato:wght@400;700' },
  Montserrat: { stack: 'Montserrat, Arial, sans-serif', google: 'Montserrat:wght@400;600' }
};

// Fonts every email client has; Gmail and Outlook only render these
export const SAFE_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman'];

export function defaultBranding(companyName = ''): EmailBranding {
  return {
    logoUrl: '', logoWidth: 140, align: 'left',
    fontFamily: 'Arial', fallbackFont: 'Arial', fontSize: 15,
    textColor: '#1f2937', accentColor: '#0a84ff', backgroundColor: '#f2f4f7', cardColor: '#ffffff',
    signature: 'Best regards,\n{{sender_name}}\n{{company}}',
    companyName, address: '', phone: '', website: '', footerNote: '',
    facebook: '', instagram: '', linkedin: ''
  };
}

const HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback);
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const url = (v: unknown) => { const s = str(v, 1000); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };

// Accepts anything (stored JSON or form input) and returns a complete, safe branding object
export function normalizeBranding(input: unknown, companyName = ''): EmailBranding {
  const d = defaultBranding(companyName);
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    logoUrl: url(b.logoUrl),
    logoWidth: Math.min(Math.max(Number(b.logoWidth) || d.logoWidth, 40), 400),
    align: b.align === 'center' ? 'center' : 'left',
    fontFamily: typeof b.fontFamily === 'string' && FONTS[b.fontFamily] ? b.fontFamily : d.fontFamily,
    fallbackFont: typeof b.fallbackFont === 'string' && SAFE_FONTS.includes(b.fallbackFont) ? b.fallbackFont : d.fallbackFont,
    fontSize: Math.min(Math.max(Number(b.fontSize) || d.fontSize, 12), 22),
    textColor: color(b.textColor, d.textColor),
    accentColor: color(b.accentColor, d.accentColor),
    backgroundColor: color(b.backgroundColor, d.backgroundColor),
    cardColor: color(b.cardColor, d.cardColor),
    signature: 'signature' in b ? str(b.signature, 500) : d.signature,
    companyName: str(b.companyName, 120) || companyName,
    address: str(b.address, 300),
    phone: str(b.phone, 60),
    website: url(b.website),
    footerNote: str(b.footerNote, 500),
    facebook: url(b.facebook),
    instagram: url(b.instagram),
    linkedin: url(b.linkedin)
  };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Plain text -> paragraphs, line breaks kept, URLs linked
function paragraphs(text: string, linkColor: string, size: number) {
  return text.trim().split(/\n{2,}/).map((p) => {
    const html = esc(p).replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${linkColor};text-decoration:underline">$1</a>`);
    return `<p style="margin:0 0 ${Math.round(size * 1.1)}px 0">${html}</p>`;
  }).join('');
}

export interface EmailContent {
  subject: string;
  body: string;
  senderName?: string;
  firstName?: string;
}

export function fillTokens(text: string, b: EmailBranding, c: EmailContent) {
  return text
    .replace(/\{\{\s*sender_name\s*\}\}/g, c.senderName || '')
    .replace(/\{\{\s*first_name\s*\}\}/g, c.firstName || '')
    .replace(/\{\{\s*company\s*\}\}/g, b.companyName || '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// opts.safeFontsOnly renders what Gmail/Outlook show (web font dropped, fallback used)
export function renderEmail(brandingInput: unknown, content: EmailContent, opts: { safeFontsOnly?: boolean } = {}): string {
  const b = normalizeBranding(brandingInput);
  const chosen = FONTS[b.fontFamily] || FONTS.Arial;
  const safe = FONTS[chosen.google ? b.fallbackFont : b.fontFamily] || FONTS.Arial;
  // Web font first, then the chosen safe font, so every client lands on a font you picked
  const font = opts.safeFontsOnly ? { stack: safe.stack } : { stack: chosen.google ? chosen.stack.split(',')[0] + ', ' + safe.stack : chosen.stack, google: chosen.google };
  const size = b.fontSize;
  const body = paragraphs(fillTokens(content.body, b, content), b.accentColor, size);
  const signature = b.signature ? paragraphs(fillTokens(b.signature, b, content), b.accentColor, size) : '';

  const logo = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" width="${b.logoWidth}" alt="${esc(b.companyName || 'Logo')}" style="display:inline-block;width:${b.logoWidth}px;max-width:100%;height:auto;border:0">`
    : b.companyName ? `<span style="font-size:${size + 5}px;font-weight:700;color:${b.textColor}">${esc(b.companyName)}</span>` : '';

  const social = [['Facebook', b.facebook], ['Instagram', b.instagram], ['LinkedIn', b.linkedin]]
    .filter(([, href]) => href)
    .map(([label, href]) => `<a href="${esc(href)}" style="color:${b.accentColor};text-decoration:none">${label}</a>`)
    .join(' &nbsp;·&nbsp; ');
  const contactLine = [b.address && esc(b.address), b.phone && esc(b.phone),
    b.website && `<a href="${esc(b.website)}" style="color:${b.accentColor};text-decoration:none">${esc(b.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`]
    .filter(Boolean).join(' &nbsp;·&nbsp; ');
  const small = Math.max(size - 3, 11);
  const footer = [
    b.companyName && `<div style="font-weight:600;color:${b.textColor}">${esc(b.companyName)}</div>`,
    contactLine && `<div style="margin-top:4px">${contactLine}</div>`,
    social && `<div style="margin-top:8px">${social}</div>`,
    b.footerNote && `<div style="margin-top:10px;opacity:.8">${esc(b.footerNote).replace(/\n/g, '<br>')}</div>`
  ].filter(Boolean).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(content.subject || '')}</title>
${font.google ? `<link href="https://fonts.googleapis.com/css2?family=${font.google}&display=swap" rel="stylesheet">` : ''}
<!--[if mso]><style>body,table,td,p,a,span,div{font-family:${safe.stack} !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${b.backgroundColor}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.backgroundColor}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${b.cardColor};border-radius:10px;overflow:hidden;border-top:4px solid ${b.accentColor}">
${logo ? `<tr><td align="${b.align}" style="padding:24px 32px 8px 32px;font-family:${font.stack}">${logo}</td></tr>` : ''}
<tr><td style="padding:16px 32px 8px 32px;font-family:${font.stack};font-size:${size}px;line-height:1.6;color:${b.textColor}">
${body}
${signature ? `<div style="margin-top:8px">${signature}</div>` : ''}
</td></tr>
${footer ? `<tr><td style="padding:16px 32px 24px 32px;border-top:1px solid rgba(0,0,0,.08);font-family:${font.stack};font-size:${small}px;line-height:1.5;color:${b.textColor};opacity:.75" align="${b.align}">${footer}</td></tr>` : ''}
</table>
</td></tr></table>
</body></html>`;
}
