// Creates (first run) or updates the Vaani agent from agent/vaani-agent.md.
// Saves the agent id to .env.local as VAANI_AGENT_ID.
// Usage: node --env-file=.env.local scripts/vaani-agent.mjs [--dump]
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://api.vaanivoice.ai/api";
const headers = { "X-API-Key": process.env.VAANI_API_KEY, "Content-Type": "application/json" };
const md = readFileSync("agent/vaani-agent.md", "utf8");
const systemPrompt = md.split("## 1. Persona / system prompt")[1].split("\n---")[0].trim();

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

let agentId = process.env.VAANI_AGENT_ID;
if (!agentId) {
  const created = await call("POST", "/create-agent", { agent_display_name: "aangan-front-desk" });
  agentId = created.agent_id;
  const env = readFileSync(".env.local", "utf8");
  writeFileSync(
    ".env.local",
    /^VAANI_AGENT_ID=.*$/m.test(env) ? env.replace(/^VAANI_AGENT_ID=.*$/m, `VAANI_AGENT_ID=${agentId}`) : `${env}\nVAANI_AGENT_ID=${agentId}\n`,
  );
  console.log("created agent", agentId);
}

if (process.argv.includes("--dump")) {
  const list = await call("GET", "/agents?page=1&page_size=50");
  console.log(JSON.stringify(list.data?.find((a) => JSON.stringify(a).includes(agentId)) ?? list, null, 1));
  process.exit(0);
}

await call("PATCH", `/agent/${agentId}/persona`, {
  identity: {
    system_prompt: systemPrompt,
    greeting_message: {
      agent_message: "Good day, you've reached Aangan Studio. How can I help you today?",
      agent_speech_delay: 0,
      interruptible: true,
      let_user_speak_first: false,
    },
  },
  // Vaani stores the language name, not the code; auto-detect lets callers switch to Hindi/Marathi
  senses_capabilities: { language: "English", auto_detect: true },
});

const dataPoints = [
  ["name", "The caller's name, if given."],
  ["phone_number", "A phone number the caller gave for callback, if different from the calling number."],
  ["project_type", "Is the site a home or an office?", ["home", "office", "other"]],
  ["locality", "Area / locality of the site, with city if mentioned."],
  ["carpet_area_sqft", "Carpet area in square feet as a number, if given."],
  ["scope", "Rooms and work the caller wants done."],
  ["completion_by", "When the caller needs the project completed, in their words."],
  ["decision_maker", "Who decides on the project (the caller, spouse, parents, company founder…)."],
  ["budget_volunteered", "Budget, ONLY if the caller stated a number themselves. Otherwise null."],
  ["booking_time", "If a consultation was booked on the call: its start date-time in ISO 8601 (Asia/Kolkata). Else null."],
].map(([name, prompt, values]) => ({ name, prompt, nullable: true, ...(values ? { values } : {}) }));

await call("PATCH", `/agent/${agentId}/analysis`, {
  evaluations: {
    dispositions: {
      enabled: true,
      prompt_based: [
        {
          name: "route",
          type: "string",
          prompt: "How did the agent route this call under Aangan Studio's rules?",
          list_of_tags: {
            qualified: "New enquiry that fits on all five criteria",
            qualified_flagged: "Fits, but budget or decision-maker is uncertain",
            follow_up: "Project, area or timeline still unclear; one question remains",
            closed: "Not a fit; closed gracefully",
            escalate: "Existing client complaint; senior callback promised",
            not_enquiry: "Wrong number, silence, or dropped before any details",
          },
        },
      ],
    },
  },
  extraction: { data_collection: { enabled: true, data_points: dataPoints } },
});

await call("PATCH", `/agent/${agentId}/experience`, {
  settings: {
    idle_conversation_settings: {
      pulse_check: true,
      end_conversation_on_idle: true,
      idle_call_warning_timeout: 10,
      idle_call_hangup_timeout: 25,
      idle_call_warning_message: "Are you still there?",
      idle_call_hangup_message: "I'll let you go for now. Please call Aangan Studio back any time. Goodbye.",
    },
    call_settings: { max_call_duration: 15, max_duration_enabled: true },
  },
});

console.log("agent configured:", agentId, `(${systemPrompt.length} chars of prompt, ${dataPoints.length} data points)`);
