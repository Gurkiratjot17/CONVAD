class IntentRouter {
  /**
   * Very simple intent routing for now.
   * Later: replace with ML/LLM classification.
   */
  route(text, context) {
    const t = (text || "").toLowerCase();

    // Task triggers (starter set)
    if (t.startsWith("calc ") || t.startsWith("calculate ")) {
      return { type: "task", taskName: "math.evaluate", confidence: 0.8 };
    }

    if (t.startsWith("echo ")) {
      return { type: "task", taskName: "echo", confidence: 0.9 };
    }

    if (t.includes("generate ad copy") || t.startsWith("adcopy ")) {
      return { type: "task", taskName: "campaign.generateCopy", confidence: 0.85 };
    }

    return { type: "chat", taskName: null, confidence: 0.6 };
  }
}

module.exports = IntentRouter;
