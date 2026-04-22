const Groq = require('groq-sdk');

/**
 * Groq LLM Service — replaces claudeService.js
 * Identical public method signatures. No route changes needed.
 * Model: llama-3.3-70b-versatile (primary), mixtral-8x7b-32768 (fallback)
 */
class GroqService {
  constructor() {
    this.client = null;
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    this.fallbackModel = 'mixtral-8x7b-32768';
  }

  getClient() {
    if (this.client) return this.client;
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required when LLM_PROVIDER=groq');
    }
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    return this.client;
  }

  async chat(messages, systemPrompt, useFallback = false) {
    try {
      const response = await this.getClient().chat.completions.create({
        model: useFallback ? this.fallbackModel : this.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1500,
        temperature: 0.1
      });
      return response.choices[0].message.content;
    } catch (err) {
      if (!useFallback && err.status === 429) {
        // Quota exceeded — retry with fallback model
        return this.chat(messages, systemPrompt, true);
      }
      throw err;
    }
  }

  async classifyAndExtract(userMessage, conversationHistory = []) {
    const systemPrompt = `You are an intelligent request classification assistant for InfoVision's Claude Assistant Bot.

Classify user messages into one of these request types:
- access: New Claude AI license request (A1)
- upgrade: License tier upgrade Standard→Premium (A2)
- skills: Professional skills/certification addition (A3)
- offboarding: Access revocation request (A4)
- connectors: Tool/platform integration setup (A6)
- plugins: Plugin deployment request (A7)
- apis: API access/quota request (A8)
- support_qa: Support issue or how-to question (A9)

For "access" type, extract these BRD §4.1 fields:
employeeId, businessUnit, costCenter, licenseType (standard|premium),
accessTier (T1|T2|T3), dateRequiredBy (YYYY-MM-DD), businessJustification,
clientProject (boolean), sowNumber, dataSensitivity, aupConfirmed (boolean).

Set aupConfirmed: true ONLY if user explicitly states agreement to AUP/Acceptable Use Policy.
If aupConfirmed is false or missing, add "aupConfirmed" to missingFields and set:
clarificationQuestion: "Before I process your request, please confirm you have read and agree to InfoVision's Claude Acceptable Use Policy (AI-001). Type 'I agree to the AUP' to confirm."

Respond ONLY with valid JSON:
{
  "type": "<type>",
  "confidence": <0-1>,
  "title": "<brief title>",
  "extractedFields": { <all extracted fields> },
  "missingFields": ["<field1>"],
  "clarificationQuestion": "<question or null>",
  "suggestedApprovers": ["<role1>"]
}`;

    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const text = await this.chat(messages, systemPrompt);
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  }

  async generateUserResponse(classification, requestContext) {
    const systemPrompt = `You are a friendly, professional assistant for InfoVision's internal request management system.
Generate clear, helpful responses that:
- Confirm what you understood from the user's request
- Ask for missing information naturally (one question at a time)
- Provide realistic expectations about approval timeline
- Are concise (2-4 sentences max)
Do not use bullet points. Write in conversational prose.`;

    const userMessage = `Generate a response for:
Type: ${classification.type}
Title: ${classification.title}
Extracted: ${JSON.stringify(classification.extractedFields)}
Missing: ${JSON.stringify(classification.missingFields)}
Clarification: ${classification.clarificationQuestion || 'None'}
Context: ${JSON.stringify(requestContext)}`;

    return this.chat([{ role: 'user', content: userMessage }], systemPrompt);
  }

  // Called by emailService.approvalRequest() to generate the email body
  async generateApprovalMessage(request, approverRole) {
    const systemPrompt = `You are a professional notification writer for InfoVision's approval workflow system.
Create a clear, concise approval request message. Write in professional business prose.`;

    const userMessage = `Generate an approval notification for:
Approver Role: ${approverRole}
Request Type: ${request.type}
Title: ${request.title}
Requester: ${request.requester?.name}
Details: ${JSON.stringify(request.details)}
Priority: ${request.priority}
Reference ID: ${request.referenceId}`;

    return this.chat([{ role: 'user', content: userMessage }], systemPrompt);
  }

  // Called in routes/requests.js chat handler for support_qa type
  async answerSupportQuestion(question, context) {
    const systemPrompt = `You are InfoVision's internal support assistant.
Answer questions clearly based on general IT and software knowledge.
If you cannot provide a definitive answer, say so and explain a support ticket will be created.
Keep responses concise and actionable.`;

    return this.chat(
      [{ role: 'user', content: `Context: ${context}\n\nQuestion: ${question}` }],
      systemPrompt
    );
  }
}

module.exports = new GroqService();
