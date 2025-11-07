// config.js
require('dotenv').config();

module.exports = {
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  maxTokens: parseInt(process.env.MAX_TOKENS, 10) || 800,
  temperature: parseFloat(process.env.TEMPERATURE) || 0.7,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'changeme',
  port: process.env.PORT || 3000,
  openaiKey: process.env.OPENAI_API_KEY || ''
};
