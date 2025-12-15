class ResponseComposer {
  composeChat(text, context) {
    // Placeholder "assistant" response for non-task messages.
    return `I’m CONVAD. If you want me to run a task, try:\n\n- \`echo hello\`\n- \`calc 12*(3+4)\`\n- \`adcopy product=Coffee audience=students tone=playful cta="Try it today"\``;
  }

  composeClarification(missingParams, toolName) {
    return `To run **${toolName}**, I still need: ${missingParams.join(", ")}.\n\nExample:\n\`adcopy product=Coffee audience=students tone=playful cta="Try it today"\``;
  }

  composeTask(result, context, plan) {
    if (!result.ok) {
      return `Task **${plan.toolName}** failed: ${result.error || "unknown error"}`;
    }

    // Prefer a tool-provided summary, fall back to JSON.
    if (result.summary) return result.summary;

    return `Task **${plan.toolName}** completed.\n\nResult:\n${JSON.stringify(result.data, null, 2)}`;
  }
}

module.exports = ResponseComposer;
