// server/utils/sanitize.js
//
// Escapes HTML-significant characters so user-supplied text can never be
// interpreted as markup/script when rendered in a browser (XSS prevention).
// This is applied server-side, at the point messages are broadcast, so
// every connected client receives already-safe text regardless of how the
// client happens to render it.

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

/**
 * Escapes a string for safe insertion into HTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"'/]/g, (char) => HTML_ESCAPE_MAP[char]);
}

module.exports = { escapeHtml };
