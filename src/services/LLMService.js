const OpenAIClient = require("./OpenAIClient");

class LLMService {
  constructor() {
    this.client = new OpenAIClient();

    this.ALLOWED_TAGS = [
      "ai","anxiety","api","backend","banking","beauty","books","budgeting",
      "buying_home","career","cloud","coffee","containers","credit_cards",
      "crypto","cybersecurity","data_science","databases","devops","docker",
      "ecommerce","entrepreneurship","exam_prep","fashion","fitness","flights",
      "frontend","furniture","gaming","health","home_cooking","home_improvement",
      "hosting","hotels","insurance","investing","kubernetes","learning",
      "machine_learning","marketing","meditation","mental_health","mobile_apps",
      "movies","muscle_building","music","mysql","nodejs","nutrition",
      "online_courses","personal_finance","photography","productivity",
      "public_transport","real_estate","recipes","renting","restaurants",
      "road_trips","sales","sleep","sports","startups","stocks","taxes",
      "time_management","travel","visa","web_development","weight_loss","yoga"
    ];
  }

  replyOnlySystemPrompt(contextmessages) {
  return `
You are CONVAD, a helpful assistant.
Return ONLY the assistant's reply as plain text.
While producing output, keep an eye on chat history being provided via ${contextmessages}
Do not output JSON.
`.trim();
}


taggerSystemPrompt() {
  return `
You are an intent tagger.
Return ONLY valid JSON and nothing else.

Schema:
{ "selected_tags": [{"tag":"string","confidence":0.0}] }

Rules:
- Choose 0–4 tags from ALLOWED_TAGS only (exact match, case-sensitive).
- If none apply, selected_tags = [].

ALLOWED_TAGS:
${this.ALLOWED_TAGS.join(", ")}
`.trim();
}

  _extractJson(raw) {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return null;
  return raw.slice(s, e + 1);
}

async classifyTags({ messages }) {
  const raw = await this.client.chat({
    system: this.taggerSystemPrompt(),
    messages,
  });

  const jsonStr = this._extractJson(raw);
  if (!jsonStr) return [];

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed?.selected_tags) ? parsed.selected_tags : [];
  } catch {
    return [];
  }
}
}

module.exports = LLMService;
