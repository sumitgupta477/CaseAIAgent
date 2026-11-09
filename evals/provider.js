// Promptfoo custom provider: runs the Case Agent's real prompt and parsing
// (Backend/terraform_code/backend/agent.js) against the OpenAI API, so the
// eval measures exactly what the Lambda does in production, minus AWS.
//
// Requires: OPENAI_API_KEY, and `npm ci` in Backend/terraform_code/backend.
// Optional: OPENAI_MODEL (defaults to the Lambda's default, gpt-4o-mini).

const path = require("node:path");

const backendDir = path.join(__dirname, "..", "Backend", "terraform_code", "backend");
const { analyze } = require(path.join(backendDir, "agent.js"));
const OpenAI = require(require.resolve("openai", { paths: [backendDir] }));

class CaseAgentProvider {
  constructor(options = {}) {
    this.config = options.config || {};
    this.model = this.config.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.providerId = options.id || `case-agent:${this.model}`;
    this.client = null;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    if (!this.client) this.client = new OpenAI();
    try {
      const { decision, usage } = await analyze(this.client, this.model, prompt);
      return {
        output: JSON.stringify(decision),
        tokenUsage: usage
          ? { total: usage.total_tokens, prompt: usage.prompt_tokens, completion: usage.completion_tokens }
          : undefined,
        metadata: { model: this.model },
      };
    } catch (err) {
      // Surface failures as errors instead of silently using the keyword
      // fallback, so outages and malformed JSON show up in the results.
      return { error: `Case agent call failed: ${err.message}` };
    }
  }
}

module.exports = CaseAgentProvider;
