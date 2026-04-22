import os
import re
from typing import Any, Dict, List, Literal, Optional, TypedDict

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from langgraph.graph import END, StateGraph


VALID_TYPES = {
    "access",
    "upgrade",
    "skills",
    "offboarding",
    "idle_reclamation",
    "connectors",
    "plugins",
    "apis",
    "support_qa",
}


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
    employee_match = re.search(r"\b(emp[-_ ]?\d{2,})\b", lower, re.IGNORECASE)
    if employee_match:
        employee_id = employee_match.group(1).upper().replace(" ", "")

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
    if req_type in {"access", "upgrade", "offboarding"} and not fields.get("employeeId"):
        missing.append("employeeId")
    if req_type == "access" and not fields.get("aupConfirmed"):
        missing.append("aupConfirmed")
    return missing


def clarification_for_missing(missing: List[str], req_type: str) -> Optional[str]:
    if not missing:
        return None
    prompts = []
    if "employeeId" in missing:
        prompts.append("Please provide the employee ID (example: EMP12345).")
    if "aupConfirmed" in missing:
        prompts.append('Please confirm AUP acceptance by replying: "I agree to the AUP".')
    prefix = f"I need a bit more information to process this {req_type} request."
    return f"{prefix} {' '.join(prompts)}"


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


class GraphState(TypedDict, total=False):
    message: str
    userContext: Dict[str, Any]
    intent: str
    extractedFields: Dict[str, Any]
    missingFields: List[str]
    clarificationQuestion: Optional[str]
    confidence: float
    suggestedApprovers: List[str]
    route: str


def node_supervisor(state: GraphState) -> GraphState:
    intent = detect_type(state.get("message", ""))
    return {"intent": intent, "route": "continue"}


def node_intent(state: GraphState) -> GraphState:
    intent = state.get("intent") or detect_type(state.get("message", ""))
    confidence = 0.82 if intent in VALID_TYPES else 0.6
    if intent not in VALID_TYPES:
        intent = "support_qa"
    return {"intent": intent, "confidence": confidence}


def node_extract(state: GraphState) -> GraphState:
    fields = extract_fields(state.get("message", ""))
    return {"extractedFields": fields}


def node_policy(state: GraphState) -> GraphState:
    intent = state.get("intent", "support_qa")
    fields = state.get("extractedFields", {})
    missing = missing_fields_for_type(intent, fields)
    clarification = clarification_for_missing(missing, intent)
    approvers = ["manager", "ai_coe_lead"] if intent in {"access", "upgrade", "plugins", "apis", "connectors"} else ["manager"]
    return {
        "missingFields": missing,
        "clarificationQuestion": clarification,
        "suggestedApprovers": approvers,
    }


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
API_KEY = os.getenv("AGENTIC_API_KEY", "").strip()
SPECIALISTS = [x.strip().lower() for x in os.getenv("AGENTIC_MULTI_SPECIALISTS", "intent,extract,policy").split(",") if x.strip()]

app = FastAPI(title="Claude Bot LangGraph Sidecar", version="1.0.0")


def auth_or_raise(authorization: Optional[str]):
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
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
    return {
        "status": "ok",
        "service": "agentic-sidecar",
        "topology": "multi",
        "specialists": SPECIALISTS,
    }


@app.post("/agent/route", response_model=ClassificationResponse)
def route_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    state: GraphState = {
        "message": payload.message,
        "userContext": payload.userContext.model_dump() if payload.userContext else {},
    }
    out = GRAPH.invoke(state)
    classification = make_classification(out)
    return ClassificationResponse(
        classification=classification,
        trace={"topology": "single", "agent": "route"},
    )


@app.post("/agent/supervisor", response_model=ClassificationResponse)
def supervisor_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    state: GraphState = {"message": payload.message}
    out = node_supervisor(state)
    out.update(node_intent({**state, **out}))
    out.update(node_extract({**state, **out}))
    out.update(node_policy({**state, **out}))
    classification = make_classification(out)
    return ClassificationResponse(
        classification=classification,
        trace={"topology": "multi", "agent": "supervisor"},
    )


@app.post("/agent/intent", response_model=ClassificationResponse)
def intent_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base = payload.supervisorOutput or {}
    state: GraphState = {
        "message": payload.message,
        "intent": (base.get("classification") or {}).get("type"),
    }
    out = node_intent(state)
    merged = {**state, **out}
    classification = make_classification(merged)
    return ClassificationResponse(
        classification=classification,
        trace={"topology": "multi", "agent": "intent"},
    )


@app.post("/agent/extract", response_model=ClassificationResponse)
def extract_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base = payload.supervisorOutput or {}
    base_classification = base.get("classification") or {}
    state: GraphState = {
        "message": payload.message,
        "intent": base_classification.get("type") or detect_type(payload.message),
        "confidence": float(base_classification.get("confidence", 0.8)),
    }
    out = node_extract(state)
    merged = {**state, **out}
    classification = make_classification(merged)
    return ClassificationResponse(
        classification=classification,
        trace={"topology": "multi", "agent": "extract"},
    )


@app.post("/agent/policy", response_model=ClassificationResponse)
def policy_agent(payload: RouteRequest, authorization: Optional[str] = Header(default=None)):
    auth_or_raise(authorization)
    base = payload.supervisorOutput or {}
    base_classification = base.get("classification") or {}
    state: GraphState = {
        "message": payload.message,
        "intent": base_classification.get("type") or detect_type(payload.message),
        "confidence": float(base_classification.get("confidence", 0.8)),
        "extractedFields": base_classification.get("extractedFields") or extract_fields(payload.message),
    }
    out = node_policy(state)
    merged = {**state, **out}
    classification = make_classification(merged)
    return ClassificationResponse(
        classification=classification,
        trace={"topology": "multi", "agent": "policy"},
    )
