// server/utils/usernameGenerator.js
//
// Generates random, human-friendly usernames like "BlueTiger482" without
// requiring any user input, account creation, or persistence.

const ADJECTIVES = [
  'Blue', 'Red', 'Green', 'Golden', 'Silver', 'Crimson', 'Shadow', 'Silent',
  'Swift', 'Brave', 'Clever', 'Mighty', 'Gentle', 'Fierce', 'Lucky', 'Wild',
  'Frosty', 'Electric', 'Cosmic', 'Mystic', 'Royal', 'Rapid', 'Sunny', 'Dark',
  'Neon', 'Crimson', 'Violet', 'Amber', 'Jade', 'Scarlet'
];

const NOUNS = [
  'Tiger', 'Falcon', 'Wolf', 'Panther', 'Eagle', 'Dragon', 'Phoenix', 'Fox',
  'Hawk', 'Lion', 'Panda', 'Otter', 'Raven', 'Shark', 'Cobra', 'Bear',
  'Wizard', 'Ninja', 'Knight', 'Ranger', 'Comet', 'Rocket', 'Ghost', 'Storm',
  'Viper', 'Lynx', 'Puma', 'Yeti', 'Griffin', 'Sparrow'
];

/**
 * Generates a random username in the form: {Adjective}{Noun}{3-digit number}
 * Example: "BlueTiger482"
 * @returns {string}
 */
function generateUsername() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 900) + 100; // 100-999
  return `${adjective}${noun}${number}`;
}

module.exports = { generateUsername };
