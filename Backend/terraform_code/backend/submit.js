// AI Case Agent: answers questions with an LLM and, when the message describes a
// problem, opens a case in DynamoDB and emails the support team via SES.
//
// Configuration comes from environment variables set by Terraform; the OpenAI
// API key is read from AWS Secrets Manager (never stored in code).

const { randomUUID } = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const OpenAI = require("openai");

const {
  CASES_TABLE,
  SES_FROM,
  ADMIN_EMAIL,
  OPENAI_SECRET_ARN,
  OPENAI_MODEL = "gpt-4o-mini",
} = process.env;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const secrets = new SecretsManagerClient({});

const CASE_KEYWORDS = ["case", "issue", "problem", "ticket", "error", "broken", "outage"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

const SYSTEM_PROMPT = `You are a helpful IT support agent.
Reply to the user, and decide whether their message reports a problem that needs a support case.
Respond ONLY with JSON: {"reply": string, "create_case": boolean, "priority": "low"|"normal"|"high"|"urgent", "summary": string}
"summary" is a one-line title for the case (empty if no case is needed).`;

// Cached across warm invocations.
let openaiClient;

async function getOpenAI() {
  if (!openaiClient) {
    const secret = await secrets.send(new GetSecretValueCommand({ SecretId: OPENAI_SECRET_ARN }));
    openaiClient = new OpenAI({ apiKey: secret.SecretString });
  }
  return openaiClient;
}

exports.handler = async (event) => {
  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const userText = (body.message || body.inputText || "").trim();
  if (!userText) return respond(400, { error: "No message provided" });
  if (userText.length > 4000) return respond(400, { error: "Message is too long" });

  try {
    const ai = await analyzeWithAI(userText);

    if (!ai.create_case) {
      return respond(200, { response: ai.reply });
    }

    const item = {
      case_id: randomUUID(),
      summary: ai.summary || userText.slice(0, 100),
      input: userText,
      priority: PRIORITIES.includes(body.priority) ? body.priority : ai.priority,
      user: body.user || "Anonymous",
      status: "OPEN",
      created_at: new Date().toISOString(),
    };

    await dynamo.send(new PutCommand({ TableName: CASES_TABLE, Item: item }));
    await sendEmail(item);

    return respond(200, {
      response: `${ai.reply}\n\nCase created: ${item.case_id} (priority: ${item.priority})`,
      case_id: item.case_id,
    });
  } catch (err) {
    // Full details go to CloudWatch Logs; callers get a generic message.
    console.error("Lambda error:", err);
    return respond(500, { error: "Something went wrong. Please try again." });
  }
};

async function analyzeWithAI(text) {
  try {
    const openai = await getOpenAI();
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      max_tokens: 400,
    });

    const parsed = JSON.parse(resp.choices[0].message.content);
    return {
      reply: String(parsed.reply || "").trim(),
      create_case: Boolean(parsed.create_case),
      priority: PRIORITIES.includes(parsed.priority) ? parsed.priority : "normal",
      summary: String(parsed.summary || "").trim(),
    };
  } catch (err) {
    // If the LLM is unavailable, fall back to keyword detection so problems still get a case.
    console.error("OpenAI error:", err);
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
}

async function sendEmail(item) {
  const text = [
    "A new case has been created.",
    "",
    `Case ID:  ${item.case_id}`,
    `Priority: ${item.priority}`,
    `Summary:  ${item.summary}`,
    `User:     ${item.user}`,
    "",
    "Message:",
    item.input,
    "",
    `Created at: ${item.created_at}`,
  ].join("\n");

  await ses.send(
    new SendEmailCommand({
      Source: SES_FROM,
      Destination: { ToAddresses: [ADMIN_EMAIL] },
      Message: {
        Subject: { Data: `[${item.priority.toUpperCase()}] Case ${item.case_id}: ${item.summary}`.slice(0, 200) },
        Body: { Text: { Data: text } },
      },
    })
  );
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
