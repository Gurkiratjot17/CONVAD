class CampaignGenerateCopyTool {
  constructor() {
    this.name = "campaign.generateCopy";
  }

  async run(input) {
    const product = String(input?.product ?? "").trim();
    const audience = String(input?.audience ?? "").trim();
    const tone = String(input?.tone ?? "").trim();
    const cta = String(input?.cta ?? "").trim();

    const missing = [];
    if (!product) missing.push("product");
    if (!audience) missing.push("audience");
    if (!tone) missing.push("tone");
    if (!cta) missing.push("cta");

    if (missing.length) {
      return { ok: false, error: `Missing: ${missing.join(", ")}`, data: null, summary: "" };
    }

    const variants = [
      this._variant1(product, audience, tone, cta),
      this._variant2(product, audience, tone, cta),
      this._variant3(product, audience, tone, cta),
    ];

    return {
      ok: true,
      data: { product, audience, tone, cta, variants },
      summary:
        `Here are 3 ${tone} ad copy options for **${product}** (audience: ${audience}):\n\n` +
        variants.map((v, i) => `${i + 1}. ${v.headline}\n   ${v.body}\n   CTA: ${v.cta}`).join("\n\n"),
    };
  }

  _variant1(product, audience, tone, cta) {
    return {
      headline: `${product}, made for ${audience}.`,
      body: `A ${tone} way to get what you want — without the hassle.`,
      cta,
    };
  }

  _variant2(product, audience, tone, cta) {
    return {
      headline: `Meet your next favorite ${product}.`,
      body: `${audience} deserve something ${tone}. Try it once — you’ll feel the difference.`,
      cta,
    };
  }

  _variant3(product, audience, tone, cta) {
    return {
      headline: `Upgrade your day with ${product}.`,
      body: `Built for ${audience}. Delivered with a ${tone} touch.`,
      cta,
    };
  }
}

module.exports = CampaignGenerateCopyTool;
