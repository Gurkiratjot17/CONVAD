const EchoTool = require("./tools/EchoTool");
const MathEvaluateTool = require("./tools/MathEvaluateTool");
const CampaignGenerateCopyTool = require("./tools/CampaignGenerateCopyTool");

class ToolRegistry {
  constructor() {
    this.tools = new Map();

    // Register tools here
    this.register(new EchoTool());
    this.register(new MathEvaluateTool());
    this.register(new CampaignGenerateCopyTool());
  }

  static getInstance() {
    if (!ToolRegistry._instance) {
      ToolRegistry._instance = new ToolRegistry();
    }
    return ToolRegistry._instance;
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name) {
    return this.tools.get(name) || null;
  }

  listTools() {
    return Array.from(this.tools.keys());
  }
}

module.exports = ToolRegistry;
