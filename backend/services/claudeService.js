const axios = require('axios');

/**
 * Claude AI Service
 *
 * This service is the intelligence layer of the bot. It handles all communication
 * with the Anthropic Claude API — from classifying request types to extracting
 * structured data from natural language and generating conversational replies.
 *
 * Design principle: All Claude prompts live here, making them easy to tune
 * without touching route or controller logic.
 */
class ClaudeService {
  constructor() {
    this.apiKey = process.env.CLAUDE_API_KEY;
    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
    this.baseURL = 'https://api.anthropic.com/v1/messages';
    this.maxTokens = 1000;
  }

  /**
   * Core method: sends a conversation to Claude and returns its reply.
   * All other methods in this service call this one.
   *
   * @param {Array} messages - Full conversation history in Claude message format
   * @param {string} systemPrompt - The system-level instruction for Claude
   */
  async chat(messages, systemPrompt) {
    const response = await axios.post(
      this.baseURL,
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages
      },
      {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.content[0].text;
  }

  /**
   * Classifies a user's natural language message into one of the six supported
   * request categories and extracts all structured fields Claude can identify.
   *
   * Returns a JSON object so the backend can route the request to the right workflow.
   */
  async classifyAndExtract(userMessage, conversationHistory = []) {
    const systemPrompt = `You are an intelligent request classification assistant for InfoVision's Claude Assistant Bot.

Your job is to analyze user messages and:
1. Classify them into one of these request types: access, skills, connectors, plugins, apis, support_qa
2. Extract all relevant structured information
3. Identify what additional information is needed

Request type definitions:
- access: System access, resource permissions, login credentials
- skills: Professional skills, certifications, training requests
- connectors: Tool and platform integrations, third-party connections
- plugins: Browser or system extensions and capability deployments
- apis: API access, quota increases, API key requests
- support_qa: Bug reports, how-to questions, issue resolution

Respond ONLY with a valid JSON object in this exact format:
{
  "type": "access|skills|connectors|plugins|apis|support_qa",
  "confidence": 0.95,
  "title": "Brief descriptive title of the request",
  "extractedFields": {
    "resourceName": "...",
    "justification": "...",
    "priority": "low|medium|high|critical",
    "duration": "...",
    "additionalDetails": {}
  },
  "missingFields": ["field1", "field2"],
  "clarificationQuestion": "Question to ask user if information is missing, or null if complete",
  "suggestedApprovers": ["manager", "admin"]
}`;

    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const responseText = await this.chat(messages, systemPrompt);

    // Strip any markdown code fences Claude might add
    const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Generates a natural, conversational reply for the requester.
   * This is what the user actually sees in Teams or the web dashboard.
   *
   * The reply acknowledges the request, confirms extracted details, and
   * asks for missing information if needed.
   */
  async generateUserResponse(classification, requestContext) {
    const systemPrompt = `You are a friendly and professional assistant for InfoVision's internal request management system.
Generate clear, helpful responses that:
- Confirm what you understood from the user's request
- Ask for missing information naturally (one question at a time)
- Provide realistic expectations about the approval process
- Are concise (2-4 sentences maximum)
- Use a warm, professional tone

Do not use bullet points. Write in flowing, conversational prose.`;

    const userMessage = `Generate a response for this classified request:
Type: ${classification.type}
Title: ${classification.title}
Extracted: ${JSON.stringify(classification.extractedFields)}
Missing: ${JSON.stringify(classification.missingFields)}
Clarification needed: ${classification.clarificationQuestion || 'None'}
Request context: ${JSON.stringify(requestContext)}`;

    return await this.chat([{ role: 'user', content: userMessage }], systemPrompt);
  }

  /**
   * Generates an approval notification message tailored to the approver's role.
   * The message summarizes the request with all the details the approver needs
   * to make a decision without having to ask follow-up questions.
   */
  async generateApprovalMessage(request, approverRole) {
    const systemPrompt = `You are a professional notification writer for InfoVision's approval workflow system.
Create a clear, concise approval request message that gives approvers all the information they need.
Write in professional business prose without bullet points.`;

    const userMessage = `Generate an approval notification for:
Approver Role: ${approverRole}
Request Type: ${request.type}
Title: ${request.title}
Requester: ${request.requester?.name}
Details: ${JSON.stringify(request.details)}
Priority: ${request.priority}
Reference ID: ${request.referenceId}`;

    return await this.chat([{ role: 'user', content: userMessage }], systemPrompt);
  }

  /**
   * Answers FAQ-style support questions using Claude's knowledge.
   * For support_qa type requests, the bot can often resolve these immediately
   * without routing to a human approver.
   */
  async answerSupportQuestion(question, context) {
    const systemPrompt = `You are InfoVision's internal support assistant.
Answer questions clearly and helpfully based on general IT and software knowledge.
If you cannot provide a definitive answer, acknowledge this and explain that a support ticket will be created for human review.
Keep responses concise and actionable.`;

    return await this.chat(
      [{ role: 'user', content: `Context: ${context}\n\nQuestion: ${question}` }],
      systemPrompt
    );
  }
}

module.exports = new ClaudeService();
