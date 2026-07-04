// server/utils/aiClient.js
//
// Thin wrapper around the OpenAI REST API (chat completions + text-to-
// speech). Uses Node's built-in global `fetch` (Node 18+) so no extra
// HTTP dependency is needed. The API key never leaves the server.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';
// "nova" and "shimmer" are OpenAI's natural, warm, female-sounding voices.
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'nova';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const TTS_URL = 'https://api.openai.com/v1/audio/speech';

function isConfigured() {
  return Boolean(OPENAI_API_KEY);
}

/**
 * Sends a conversation (array of { role, content }) to OpenAI's chat
 * completion endpoint and returns the assistant's reply text.
 */
async function getChatCompletion(messages) {
  if (!isConfigured()) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      max_tokens: 600,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI chat completion failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI chat completion returned an empty response.');
  }
  return text.trim();
}

/**
 * Converts text to natural-sounding speech audio (mp3 bytes, as a Buffer)
 * using OpenAI's text-to-speech endpoint with a female-sounding voice.
 */
async function textToSpeech(text) {
  if (!isConfigured()) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const response = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text.slice(0, 4000), // OpenAI TTS input length safety margin
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI text-to-speech failed (${response.status}): ${errorBody}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { isConfigured, getChatCompletion, textToSpeech };
