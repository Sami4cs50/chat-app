// server/utils/nameExtractor.js
//
// Small heuristic parser used only for the AI room's first-conversation
// flow: turning a free-text reply like "My name is Sami" or just "Sami"
// into a clean display name to remember.

const NAME_PATTERNS = [
  /\bmy name is\s+([a-zA-Z][a-zA-Z' -]{0,29})/i,
  /\bcall me\s+([a-zA-Z][a-zA-Z' -]{0,29})/i,
  /\byou can call me\s+([a-zA-Z][a-zA-Z' -]{0,29})/i,
  /\bi am\s+([a-zA-Z][a-zA-Z' -]{0,29})/i,
  /\bi'm\s+([a-zA-Z][a-zA-Z' -]{0,29})/i,
];

function cleanName(raw) {
  const trimmed = raw.trim().replace(/[.!?,;:]+$/, '');
  if (!trimmed) return null;

  return trimmed
    .split(/\s+/)
    .slice(0, 3) // cap at 3 words, e.g. "Sami Ben Ali"
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 30);
}

/**
 * Attempts to pull a name out of a free-text reply. Tries common phrasings
 * first ("my name is X", "call me X", ...); if none match and the reply is
 * short (<=3 words, <=30 chars), assumes the whole reply IS the name (the
 * user just typed "Sami" in response to the AI's question).
 */
function extractPreferredName(rawText) {
  const text = (rawText || '').trim();
  if (!text) return null;

  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanName(match[1]);
      if (cleaned) return cleaned;
    }
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= 3 && text.length <= 30) {
    return cleanName(text);
  }

  return null;
}

module.exports = { extractPreferredName };
