import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Literal, Optional, TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from groq import Groq
try:
    from langgraph.graph import END, StateGraph
except ImportError:
    from langgraph.graph.state import StateGraph  # type: ignore[no-redef]
    from langgraph.graph import END  # type: ignore[assignment]
from pydantic import BaseModel, Field

load_dotenv()

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("agentic-sidecar")

# ── Constants ─────────────────────────────────────────────────────────────────
VALID_TYPES = {
    "access", "upgrade", "skills", "offboarding",
    "idle_reclamation", "connectors", "plugins", "apis", "support_qa",
}

REQUIRED_FIELDS: Dict[str, List[str]] = {
    "access": ["employeeId", "aupConfirmed"],
    "upgrade": ["employeeId"],
    "offboarding": ["employeeId"],
}

APPROVER_CHAIN: Dict[str, List[str]] = {
    "access": ["manager", "ai_coe_lead"],
    "upgrade": ["manager", "ai_coe_lead"],
    "skills": ["manager", "ai_coe_lead"],
    "offboarding": ["manager", "ai_coe_lead"],
    "idle_reclamation": [],
    "connectors": ["manager", "ai_coe_lead"],
    "plugins": ["manager", "ai_coe_lead"],
    "apis": ["manager", "ai_coe_lead"],
    "support_qa": ["manager", "ai_coe_lead"],
}

API_KEY = os.getenv("AGENTIC_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
SPECIALISTS = [
    x.strip().lower()
    for x in os.getenv("AGENTIC_MULTI_SPECIALISTS", "intent,extract,policy").split(",")
    if x.strip()
]

# ── Groq client (lazy init) ───────────────────────────────────────────────────
_groq_client: Optional[Groq] = None


def get_groq_client() -> Groq:
    global _groq_client
    if _groq_client is None:
        if not GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


def groq_json_call(system: str, user: str, node_name: str) -> str:
    """Call Groq and return raw text. Raises on error — caller handles fallback."""
    t0 = time.monotonic()
    client = get_groq_client()
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=512,
        temperature=0.0,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    logger.info(f"node={node_name} latency_ms={latency_ms}")
    return response.choices[0].message.content or ""


# ── Keyword / regex fallbacks ─────────────────────────────────────────────────
def normalize_text(text: str) -> str:
    return (text or "").strip().lower()


def detect_type(message: str) -> str:
    t = normalize_text(message)
    if any(k in t for k in ["offboard", "off-boarding", "deactivate user", "revoke access", "exit employee"]):
        return "offboarding"
    if any(k in t for k in ["upgrade", "higher tier", "tier change", "premium"]):
        return "upgrade"
    if any(k in t for k in ["connector", "connect to", "integration"]):
        return "connectors"
    if any(k in t for k in ["plugin", "plug-in", "extension deploy"]):
        return "plugins"
    if any(k in t for k in ["api", "token", "quota", "endpoint access"]):
        return "apis"
    if any(k in t for k in ["skill", "prompt library", "knowledge"]):
        return "skills"
    if any(k in t for k in ["idle", "unused", "reclaim license"]):
        return "idle_reclamation"
    if any(k in t for k in ["support", "bug", "issue", "qa", "help"]):
        return "support_qa"
    return "access"


def extract_fields(message: str) -> Dict[str, Any]:
    text = message or ""
    lower = text.lower()
    employee_id = None
    m = re.search(r"\b(emp[-_ ]?\d{2,})\b", lower, re.IGNORECASE)
    if m:
        employee_id = m.group(1).upper().replace(" ", "")
    license_type = "premium" if "premium" in lower else "standard"
    access_tier = "T1" if "t1" in lower else ("T3" if "t3" in lower else "T2")
    aup_confirmed = bool(
        re.search(r"\bi agree to (the )?aup\b", lower)
        or "aup confirmed" in lower
        or "accepted aup" in lower
    )
    priority = "high" if any(k in lower for k in ["urgent", "critical", "asap"]) else "medium"
    return {
        "employeeId": employee_id,
        "licenseType": license_type,
        "accessTier": access_tier,
        "priority": priority,
        "aupConfirmed": aup_confirmed,
        "businessJustification": text[:280] if text else "",
    }


def missing_fields_for_type(req_type: str, fields: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    required = REQUIRED_FIELDS.get(req_type, [])
    if "employeeId" in required and not fields.get("employeeId"):
        missing.append("employeeId")
    if "aupConfirmed" in required and not fields.get("aupConfirmed"):
        missing.append("aupConfirmed")
    return missing


def clarification_for_missing(missing: List[str], req_type: str) -> Optional[str]:
    if not missing:
        return None
    prompts = []
    if "employeeId" in missing:
        prompts.append("Please provide the employee ID (e.g. EMP12345).")
    if "aupConfirmed" in missing:
        prompts.append('Please confirm AUP acceptance: "I agree to the AUP".')
    return f"I need a bit more information to process this {req_type} request. {' '.join(prompts)}"


# ── Pydantic models ───────────────────────────────────────────────────────────
class UserContext(BaseModel):
    id: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    email: Optional[str] = None


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class RouteRequest(BaseModel):
    message: str
    conversationHistory: List[ConversationMessage] = Field(default_factory=list)
    userContext: Optional[UserContext] = None
    supervisorOutput: Optional[Dict[str, Any]] = None


class Classification(BaseModel):
    type: str
    title: str
    confidence: float
    extractedFields: Dict[str, Any]
    missingFields: List[str] = Field(default_factory=list)
    clarificationQuestion: Optional[str] = None
    suggestedApprovers: List[str] = Field(default_factory=list)


class ClassificationResponse(BaseModel):
    classification: Classification
    trace: Dict[str, Any]


# ── LangGraph state ───────────────────────────────────────────────────────────
class GraphState(TypedDict, total=False):
    message: str
    userContext: Dict[str, Any]
    intent: str
    confidence: float
    extractedFields: Dict[str, Any]
    missingFields: List[str]
    clarificationQuestion: Optional[str]
    suggestedApprovers: List[str]
    route: str


# ── LangGraph nodes ───────────────────────────────────────────────────────────
def node_supervisor(state: GraphState) -> GraphState:
    msg = state.get("message", "")
    system = (
        "You are a request classifier for InfoVision's Claude Assistant Bot. "
        "Classify the user message into EXACTLY ONE of: "
        "access, upgrade, skills, offboarding, idle_reclamation, connectors, plugins, apis, support_qa. "
        'Return ONLY valid JSON with one key: {"intent": "<type>"}'
    )
    try:
        raw = groq_json_call(system, msg, "supervisor")
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(cleaned)
        intent = data.get("intent", "").lower()
        if intent not in VALID_TYPES:
            intent = detect_type(msg)
    except Exception as e:
        logger.warning(f"node=supervisor groq_error={e} fallback=keyword")
        intent = detect_type(msg)
    return {"intent": intent, "route": "continue"}


def node_intent(state: GraphState) -> GraphState:
    msg = state.get("message", "")
    current_intent = state.get("intent") or detect_type(msg)
    system = (
        "You are a request classifier. Confirm or correct the intent classification and provide a confidence score. "
        f"Current intent: {current_intent}. "
        "Valid types: access, upgrade, skills, offboarding, idle_reclamation, connectors, plugins, apis, support_qa. "
        'Return ONLY valid JSON: {"intent": "<type>", "confidence": <0.0-1.0>}'
    )
    try:
        raw = groq_json_call(system, msg, "intent")
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(cleaned)
        intent = data.get("intent", current_intent).lower()
        confidence = float(data.get("confidence", 0.8))
        if intent not in VALID_TYPES:
            intent = current_intent
    except Exception as e:
        logger.warning(f"node=intent groq_error={e} fallback=passthrough")
        intent = current_intent
        confidence = 0.75
    return {"intent": intent, "confidence": confidence}


def node_extract(state: GraphState) -> GraphState:
    msg = state.get("message", "")
    system = (
        "You are a field extractor for InfoVision's request system. "
        "Extract structured fields from the user message. "
        "Return ONLY valid JSON with these keys (use null if not found): "
        '{"employeeId": "EMP12345 or null", "licenseType": "standard or premium", '
        '"accessTier": "T1 or T2 or T3", "priority": "low or medium or high or critical", '
        '"aupConfirmed": true or false, "businessJustification": "first 280 chars of context"}'
    )
    try:
        raw = groq_json_call(system, msg, "extract")
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        fields = json.loads(cleaned)
        fields["aupConfirmed"] = bool(fields.get("aupConfirmed", False))
        fields["employeeId"] = fields.get("employeeId") or None
        fields["licenseType"] = fields.get("licenseType", "standard")
        fields["accessTier"] = fields.get("accessTier", "T2")
        fields["priority"] = fields.get("priority", "medium")
        fields["businessJustification"] = str(fields.get("businessJustification") or "")[:280]
    except Exception as e:
        logger.warning(f"node=extract groq_error={e} fallback=regex")
        fields = extract_fields(msg)
    return {"extractedFields": fields}


def node_policy(state: GraphState) -> GraphState:
    intent = state.get("intent", "support_qa")
    fields = state.get("extractedFields", {})
    missing = missing_fields_for_type(intent, fields)
    clarification = clarification_for_missing(missing, intent)
    approvers = APPROVER_CHAIN.get(intent, ["manager"])
    return {
        "missingFields": missing,
        "clarificationQuestion": clarification,
        "suggestedApprovers": approvers,
    }


# ── Compiled LangGraph (used by /agent/route) ─────────────────────────────────
def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("supervisor", node_supervisor)
    graph.add_node("intent", node_intent)
    graph.add_node("extract", node_extract)
    graph.add_node("policy", node_policy)
    graph.set_entry_point("supervisor")
    graph.add_edge("supervisor", "intent")
    graph.add_edge("intent", "extract")
    graph.add_edge("extract", "policy")
    graph.add_edge("policy", END)
    return graph.compile()


GRAPH = build_graph()

# ── FastAPI ───────────────────────────────────────────────────────────────────
app = FastAPI(title="Claude Bot LangGraph Sidecar", version="2.0.0")


def auth_or_raise(authorization: Optional[str]) -> None:
    if not API_KEY:
        return  # auth disabled when key not configured (local dev)
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def make_classification(payload: Dict[str, Any]) -> Classification:
    req_type = payload.get("intent", "support_qa")
    if req_type not in VALID_TYPES:
        req_type = "support_qa"
    fields = payload.get("extractedFields", {})
    title = f"{req_type.replace('_', ' ').title()} Request"
    return Classification(
        type=req_type,
        title=title,
        confidence=float(payload.get("confidence", 0.75)),
        extractedFields=fields,
        missingFields=payload.get("missingFields", []) or [],
        clarificationQuestion=payload.get("clarificationQuestion"),
        suggestedApprovers=payload.get("suggestedApprovers", []) or [],
    )


@app.get("/health")
def health():
    groq_ok = False
    groq_latency_ms = None
    if GROQ_API_KEY:
        try:
            t0 = time.monotonic()
            client = get_groq_client()
            client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            groq_latency_ms = int((time.monotonic() - t0) * 1000)
            groq_ok = True
        except Exception as e:
            logger.warning(f"health_check groq_error={e}")
    return {
        "status": "ok",
        "service": "agentic-sidecar",
        "topology": "multi",
        "groq_ok": groq_ok,
        "groq_latency_ms": groq_latency_ms,
        "specialists": SPECIALISTS,
    }


@app.post("/agent/supervisor", response_model=ClassificationResponse)
def supervisor_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    """Primary production endpoint — runs all nodes sequentially, accumulates state."""
    auth_or_raise(authorization)
    state: GraphState = {
        "message": payload.message,
        "userContext": payload.userContext.model_dump() if payload.userContext else {},
    }
    state.update(node_supervisor(state))
    state.update(node_intent(state))
    state.update(node_extract(state))
    state.update(node_policy(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "supervisor"},
    )


@app.post("/agent/intent", response_model=ClassificationResponse)
def intent_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base_cls = (payload.supervisorOutput or {}).get("classification") or {}
    state: GraphState = {"message": payload.message, "intent": base_cls.get("type")}
    state.update(node_intent(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "intent"},
    )


@app.post("/agent/extract", response_model=ClassificationResponse)
def extract_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base_cls = (payload.supervisorOutput or {}).get("classification") or {}
    state: GraphState = {
        "message": payload.message,
        "intent": base_cls.get("type") or detect_type(payload.message),
        "confidence": float(base_cls.get("confidence", 0.8)),
    }
    state.update(node_extract(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "extract"},
    )


@app.post("/agent/policy", response_model=ClassificationResponse)
def policy_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base_cls = (payload.supervisorOutput or {}).get("classification") or {}
    state: GraphState = {
        "message": payload.message,
        "intent": base_cls.get("type") or detect_type(payload.message),
        "confidence": float(base_cls.get("confidence", 0.8)),
        "extractedFields": base_cls.get("extractedFields") or extract_fields(payload.message),
    }
    state.update(node_policy(state))
    return ClassificationResponse(
        classification=make_classification(state),
        trace={"topology": "multi", "agent": "policy"},
    )


@app.post("/agent/route", response_model=ClassificationResponse)
def route_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    """Single compiled LangGraph execution — fallback and test endpoint."""
    auth_or_raise(authorization)
    state: GraphState = {
        "message": payload.message,
        "userContext": payload.userContext.model_dump() if payload.userContext else {},
    }
    out = GRAPH.invoke(state)
    return ClassificationResponse(
        classification=make_classification(out),
        trace={"topology": "single", "agent": "route"},
    )
