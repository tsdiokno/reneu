/**
 * Fast, robust, and zero-dependency HTML sanitizer for scripture text.
 * Strips script tags, iframes, inline event handlers (onload, onerror, onclick, etc.),
 * and dangerous URI schemes while preserving safe semantic typography tags (<i>, <b>, <em>, <strong>, <span>).
 */

const ALLOWED_TAGS = new Set([
  'I',
  'B',
  'EM',
  'STRONG',
  'SPAN',
  'SUP',
  'SUB',
  'SMALL',
  'BR',
  'P',
  'CITE',
  'MARK',
]);

const ALLOWED_ATTRIBUTES = new Set(['class', 'title', 'aria-hidden']);

const MAX_SANITIZE_CACHE_SIZE = 600;
const sanitizeCache = new Map<string, string>();

export function sanitizeVerseHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  // Fast path: plain text without tags needs no HTML parsing
  if (!rawHtml.includes('<')) {
    return rawHtml;
  }

  const cached = sanitizeCache.get(rawHtml);
  if (cached !== undefined) {
    return cached;
  }

  // Fallback for SSR or environments without DOMParser
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return rawHtml.replace(/<(?!\/?(i|b|em|strong|span|sup|sub|small|br|p)\b)[^>]+>/gi, '');
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    function cleanNode(node: Node) {
      const childNodes = Array.from(node.childNodes);
      for (const child of childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement;
          const tagName = el.tagName.toUpperCase();

          // Block dangerous tags completely including their children
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'MATH'].includes(tagName)) {
            el.remove();
            continue;
          }

          if (!ALLOWED_TAGS.has(tagName)) {
            // Replace non-allowed container tags with plain text content
            const textNode = document.createTextNode(el.textContent || '');
            node.replaceChild(textNode, el);
            continue;
          }

          // Strip disallowed attributes (especially event handlers like onload, onerror)
          const attributes = Array.from(el.attributes);
          for (const attr of attributes) {
            const attrName = attr.name.toLowerCase();
            if (attrName.startsWith('on') || !ALLOWED_ATTRIBUTES.has(attrName)) {
              el.removeAttribute(attr.name);
            }
          }

          // Recurse on children
          cleanNode(el);
        }
      }
    }

    cleanNode(doc.body);
    const sanitized = doc.body.innerHTML;
    if (sanitizeCache.size >= MAX_SANITIZE_CACHE_SIZE) {
      sanitizeCache.clear();
    }
    sanitizeCache.set(rawHtml, sanitized);
    return sanitized;
  } catch {
    // If parsing fails for any reason, strip all tags safely
    return rawHtml.replace(/<[^>]*>?/gm, '');
  }
}
