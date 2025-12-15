class EchoTool {
  constructor() {
    this.name = "echo";
  }

  async run(input) {
    const text = input?.text ?? "";
    return {
      ok: true,
      data: { echoed: text },
      summary: `Echo: "${text}"`,
    };
  }
}

module.exports = EchoTool;
