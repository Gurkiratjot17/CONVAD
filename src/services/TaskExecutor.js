const ToolRegistry = require("../tools/ToolRegistry");

class TaskExecutor {
  constructor() {
    this.registry = ToolRegistry.getInstance();
  }

  async execute(plan) {
    const tool = this.registry.getTool(plan.toolName);
    if (!tool) {
      return { ok: false, error: `Tool not found: ${plan.toolName}`, data: null, summary: "" };
    }

    try {
      const result = await tool.run(plan.params);
      return result;
    } catch (err) {
      return { ok: false, error: err?.message || "Tool failed", data: null, summary: "" };
    }
  }
}

module.exports = TaskExecutor;
