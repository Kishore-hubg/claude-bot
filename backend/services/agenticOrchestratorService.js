const axios = require('axios');
const llmService = require('./llmService');

const VALID_TYPES = new Set([
  'access',
  'upgrade',
  'skills',
  'offboarding',
  'idle_reclamation',
  'connectors',
  'plugins',
  'apis',
  'support_qa'
]);

const getMode = () => {
  const mode = String(process.env.AGENTIC_MODE || 'off').toLowerCase();
  return ['off', 'shadow', 'on'].includes(mode) ? mode : 'off';
};

const getTimeoutMs = () => {
  const parsed = parseInt(process.env.AGENTIC_TIMEOUT_MS || '6000', 10);
  if (Number.isNaN(parsed) || parsed < 500) return 6000;
  return parsed;
};

const getTopology = () => {
  const topology = String(process.env.AGENTIC_ORCHESTRATION || 'single').toLowerCase();
  return ['single', 'multi'].includes(topology) ? topology : 'single';
};

const getSpecialistAgents = () => {
  const raw = process.env.AGENTIC_MULTI_SPECIALISTS || 'intent,extract,policy';
  return raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
};

const toSafeError = (err) => err?.response?.data?.message || err?.message || 'Agentic service unavailable';

const isValidClassification = (obj) => {
  if (!obj || typeof obj !== 'object') return false;
  if (!obj.type || !VALID_TYPES.has(obj.type)) return false;
  if (!obj.title || typeof obj.title !== 'string') return false;
  if (!obj.extractedFields || typeof obj.extractedFields !== 'object') return false;
  return true;
};

const getAgenticClientConfig = () => {
  const baseUrl = process.env.AGENTIC_API_URL;
  if (!baseUrl) {
    throw new Error('AGENTIC_API_URL is not configured');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AGENTIC_API_KEY) {
    headers.Authorization = `Bearer ${process.env.AGENTIC_API_KEY}`;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), headers };
};

const postAgent = async (path, payload) => {
  const { baseUrl, headers } = getAgenticClientConfig();
  const url = `${baseUrl}${path}`;
  const { data } = await axios.post(url, payload, { timeout: getTimeoutMs(), headers });
  return data;
};

const getInputPayload = ({ message, conversationHistory, user }) => ({
  message,
  conversationHistory,
  userContext: user
    ? {
        id: user._id?.toString?.() || String(user._id || ''),
        role: user.role,
        department: user.department,
        email: user.email
      }
    : null
});

const callSingleAgentRoute = async ({ message, conversationHistory, user }) => {
  const input = getInputPayload({ message, conversationHistory, user });
  const data = await postAgent('/agent/route', input);
  const classification = data?.classification || data;
  if (!isValidClassification(classification)) {
    throw new Error('Agentic response schema invalid');
  }
  return {
    classification,
    agentTrace: {
      topology: 'single',
      agentsInvoked: ['route'],
      successfulAgents: ['route']
    }
  };
};

const pickFirstValidClassification = (items = []) => {
  for (const item of items) {
    const candidate = item?.classification || item;
    if (isValidClassification(candidate)) return candidate;
  }
  return null;
};

const callMultiAgentRoute = async ({ message, conversationHistory, user }) => {
  const input = getInputPayload({ message, conversationHistory, user });
  const specialists = getSpecialistAgents();

  // 1) Supervisor decides/initializes orchestration.
  const supervisorData = await postAgent('/agent/supervisor', input);
  const supervisorCandidate = supervisorData?.classification || supervisorData;

  // 2) Specialist agents run in parallel and can refine/validate output.
  const specialistCalls = specialists.map((name) =>
    postAgent(`/agent/${name}`, { ...input, supervisorOutput: supervisorData })
  );
  const specialistResults = await Promise.allSettled(specialistCalls);
  const fulfilled = specialistResults
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  const classification = pickFirstValidClassification(fulfilled) ||
    (isValidClassification(supervisorCandidate) ? supervisorCandidate : null);
  if (!classification) {
    throw new Error('Agentic multi-agent response schema invalid');
  }

  const successfulAgents = ['supervisor'];
  specialists.forEach((name, idx) => {
    if (specialistResults[idx]?.status === 'fulfilled') {
      successfulAgents.push(name);
    }
  });

  return {
    classification,
    agentTrace: {
      topology: 'multi',
      agentsInvoked: ['supervisor', ...specialists],
      successfulAgents
    }
  };
};

const callAgenticRoute = async ({ message, conversationHistory, user }) => {
  const topology = getTopology();
  if (topology === 'multi') {
    try {
      return await callMultiAgentRoute({ message, conversationHistory, user });
    } catch {
      // Compatibility fallback: if the sidecar only exposes single-agent route.
      return callSingleAgentRoute({ message, conversationHistory, user });
    }
  }
  return callSingleAgentRoute({ message, conversationHistory, user });
};

const mergeTrace = (orchestration, trace) => {
  if (!trace) return orchestration;
  return {
    ...orchestration,
    topology: trace.topology,
    agentsInvoked: trace.agentsInvoked,
    successfulAgents: trace.successfulAgents,
    agentsCount: trace.agentsInvoked?.length || 0
  };
};

const callLegacy = async (message, conversationHistory) =>
  llmService.classifyAndExtract(message, conversationHistory);

const compareClassifications = (legacy, agentic) => ({
  typeMatch: legacy?.type === agentic?.type,
  titleMatch: legacy?.title === agentic?.title,
  missingFieldsDelta:
    (agentic?.missingFields?.length || 0) - (legacy?.missingFields?.length || 0)
});

const classifyAndExtract = async ({ message, conversationHistory = [], user = null }) => {
  const mode = getMode();

  if (mode === 'off') {
    const classification = await callLegacy(message, conversationHistory);
    return {
      classification,
      orchestration: {
        mode,
        primarySource: 'legacy_llm',
        fallbackUsed: false
      }
    };
  }

  if (mode === 'on') {
    try {
      const { classification, agentTrace } = await callAgenticRoute({ message, conversationHistory, user });
      return {
        classification,
        orchestration: mergeTrace({
          mode,
          primarySource: 'agentic',
          fallbackUsed: false
        }, agentTrace)
      };
    } catch (err) {
      const fallback = await callLegacy(message, conversationHistory);
      return {
        classification: fallback,
        orchestration: {
          mode,
          primarySource: 'legacy_llm',
          fallbackUsed: true,
          fallbackReason: toSafeError(err)
        }
      };
    }
  }

  // shadow mode: legacy output is authoritative, agentic runs side-by-side for comparison.
  const legacy = await callLegacy(message, conversationHistory);
  try {
    const { classification: agentic, agentTrace } = await callAgenticRoute({ message, conversationHistory, user });
    return {
      classification: legacy,
      orchestration: mergeTrace({
        mode,
        primarySource: 'legacy_llm',
        fallbackUsed: false,
        shadow: {
          ran: true,
          comparison: compareClassifications(legacy, agentic)
        }
      }, agentTrace)
    };
  } catch (err) {
    return {
      classification: legacy,
      orchestration: {
        mode,
        primarySource: 'legacy_llm',
        fallbackUsed: false,
        shadow: {
          ran: false,
          reason: toSafeError(err)
        }
      }
    };
  }
};

module.exports = {
  classifyAndExtract
};
