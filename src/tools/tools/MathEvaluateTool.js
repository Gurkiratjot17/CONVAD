class MathEvaluateTool {
  constructor() {
    this.name = "math.evaluate";
  }

  async run(input) {
    const expr = String(input?.expression ?? "").trim();
    if (!expr) {
      return { ok: false, error: "expression is required", data: null, summary: "" };
    }

    // Safety: allow only digits, operators, whitespace, parentheses, decimal points
    // NOTE: This is still a simplistic approach. Good enough for a demo.
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
      return { ok: false, error: "Invalid characters in expression", data: null, summary: "" };
    }

    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${expr});`)();

    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
      return { ok: false, error: "Expression did not produce a finite number", data: null, summary: "" };
    }

    return {
      ok: true,
      data: { expression: expr, value },
      summary: `Result: **${value}**`,
    };
  }
}

module.exports = MathEvaluateTool;
