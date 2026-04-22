const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

let llmService;
if (provider === 'gemini') {
  llmService = require('./geminiService');
} else {
  llmService = require('./groqService');
}

module.exports = llmService;
