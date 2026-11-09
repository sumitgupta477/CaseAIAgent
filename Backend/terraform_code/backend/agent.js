// Core LLM logic for the AI Case Agent, kept free of AWS calls so the exact
// same prompt and parsing can be used by the Lambda (submit.js) and by the
// offline evaluation suite (evals/).

const CASE_KEYWORDS = ["case", "issue", "problem", "ticket", "error", "broken", "outage"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

const SYSTEM_PROMPT = `You are a helpful IT support agent.
Reply to the user, and decide whether their message reports a problem that needs a support case.
Respond ONLY with JSON: {"reply": string, "create_case": boolean, "priority": "low"|"normal"|"high"|"urgent", "summary": string}
"summary" is a one-line title for the case (empty if no case is needed).`;

/**
 * Ask the model to reply and decide whether a case is needed.
 * Throws if the API call fails or the response is not valid JSON, so callers
 * decide how to handle failures (the Lambda falls back to keywords; the eval
 * suite records the failure).
 */
async function analyze(openai, model, text) {
  const resp = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    max_tokens: 400,
    // Unset in production (provider default). The eval sets LLM_TEMPERATURE=0
    // for small local models so repeated runs are comparable.
    ...(process.env.LLM_TEMPERATURE ? { temperature: Number(process.env.LLM_TEMPERATURE) } : {}),
  });

  const content = resp?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Unexpected model response: ${JSON.stringify(resp).slice(0, 300)}`);
  }
  const parsed = JSON.parse(content);
  return {
    decision: {
      reply: String(parsed.reply || "").trim(),
      create_case: Boolean(parsed.create_case),
      priority: PRIORITIES.includes(parsed.priority) ? parsed.priority : "normal",
      summary: String(parsed.summary || "").trim(),
    },
    usage: resp.usage,
  };
}

/** Used when the LLM is unavailable, so problem reports still become cases. */
function keywordFallback(text) {
  const looksLikeProblem = CASE_KEYWORDS.some((k) => text.toLowerCase().includes(k));
  return {
    reply: looksLikeProblem
      ? "Our AI assistant is temporarily unavailable, so we've logged your request for the support team."
      : "Sorry, the AI assistant is temporarily unavailable. Please try again shortly.",
    create_case: looksLikeProblem,
    priority: "normal",
    summary: "",
  };
}

module.exports = { SYSTEM_PROMPT, PRIORITIES, CASE_KEYWORDS, analyze, keywordFallback };
