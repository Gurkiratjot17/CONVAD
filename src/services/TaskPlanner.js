class TaskPlanner {
  /**
   * Converts an intent + text into a TaskPlan.
   * For now: naive parsing rules.
   */
  plan(intent, text, context) {
    const taskName = intent.taskName;

    if (taskName === "echo") {
      const payload = text.replace(/^echo\s+/i, "");
      return this._planOk("echo", { text: payload });
    }

    if (taskName === "math.evaluate") {
      // "calc 2+2" or "calculate 2+2"
      const expr = text.replace(/^calc\s+/i, "").replace(/^calculate\s+/i, "");
      if (!expr.trim()) return this._planNeed("math.evaluate", ["expression"]);
      return this._planOk("math.evaluate", { expression: expr.trim() });
    }

    if (taskName === "campaign.generateCopy") {
      // Format: "adcopy product=... audience=... tone=... cta=..."
      const params = this._parseKeyValue(text);

      const missing = [];
      if (!params.product) missing.push("product");
      if (!params.audience) missing.push("audience");
      if (!params.tone) missing.push("tone");
      if (!params.cta) missing.push("cta");

      if (missing.length) return this._planNeed("campaign.generateCopy", missing);
      return this._planOk("campaign.generateCopy", params);
    }

    // Unknown task
    return {
      toolName: "echo",
      params: { text: `Unknown task: ${taskName}. I can only do echo, calc, and adcopy right now.` },
      requiresClarification: false,
      missingParams: [],
    };
  }

  _planOk(toolName, params) {
    return { toolName, params, requiresClarification: false, missingParams: [] };
  }

  _planNeed(toolName, missingParams) {
    return { toolName, params: {}, requiresClarification: true, missingParams };
  }

  _parseKeyValue(text) {
    // naive key=value parser
    // Example: adcopy product=Sneakers audience="students" tone=playful cta="Buy now"
    const out = {};
    const pairs = text.replace(/^adcopy\s+/i, "").split(/\s+/);

    for (const p of pairs) {
      const idx = p.indexOf("=");
      if (idx === -1) continue;
      const key = p.slice(0, idx).trim();
      let val = p.slice(idx + 1).trim();

      // strip surrounding quotes if user used simple quotes in one token
      val = val.replace(/^"(.+)"$/, "$1").replace(/^'(.+)'$/, "$1");
      out[key] = val;
    }
    return out;
  }
}

module.exports = TaskPlanner;
