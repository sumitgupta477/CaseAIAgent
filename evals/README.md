# LLM evaluation and drift detection

This folder tests the Case Agent's LLM behaviour against a **golden dataset** and compares every run with a saved **baseline**, so quality regressions are caught automatically, whether they come from a prompt change, a code change, or the model provider quietly updating the model.

## What is measured

The eval runs the **production prompt and parsing** (`Backend/terraform_code/backend/agent.js`, the same module the Lambda uses) over 24 test messages in [`tests.yaml`](tests.yaml): greetings and questions, problems at every priority, and robustness cases (no trigger keywords, angry users, Spanish, prompt-injection attempts).

| Metric | How it is scored | Applies to |
|---|---|---|
| `valid_json` | Output parses as JSON | All tests |
| `case_decision` | `create_case` matches the expected decision | All tests |
| `priority` | Priority is one of the acceptable values | Case tests |
| `summary` | Non-empty one-line case title | Case tests |
| `reply_quality` | **LLM-as-a-judge** (`llm-rubric`) grades the reply against a per-test rubric | All tests |
| `pass_rate`, `error_rate` | Share of runs passing every check, and share failing with API/runtime errors | All tests |

Latency and tokens per call are tracked too, as warnings.

## How drift detection works

1. **Baseline:** run the eval once on a known-good version and save the scores to `baseline.json` (committed, so every change to it is reviewed in a PR).
2. **Every run** (`drift_check.py`) compares the new scores with the baseline over the tests both runs share, and fails if:
   - any quality metric or the pass rate drops by more than **0.05** (`--tolerance`), or
   - the error rate rises by more than 0.05.
3. It lists the individual tests that regressed, warns if latency or token use jumped, and warns if the model, judge model or promptfoo version differs from the baseline (so you know a score change may not be your code).

The CI workflow (`.github/workflows/llm-eval-drift.yml`) runs this on pull requests that touch the agent or the eval, and **weekly** to catch silent model updates. Each test runs 3 times (`--repeat 3`) to smooth out model randomness. A summary table appears on the workflow run page.

## Run it locally

Requirements: Node.js 20+, Python 3.9+, an OpenAI API key.

```bash
cd Backend/terraform_code/backend && npm ci && cd -
export OPENAI_API_KEY=sk-...

mkdir -p evals/results
npx promptfoo@0.125.1 eval -c evals/promptfooconfig.yaml --repeat 3 -o evals/results/latest.json
python3 evals/drift_check.py evals/results/latest.json
npx promptfoo@0.125.1 view   # optional: browse results in the web UI
```

### Create or update the baseline

Do this the first time, and again whenever you **intentionally** change behaviour (new prompt, new model, edited dataset):

```bash
python3 evals/drift_check.py evals/results/latest.json --update-baseline
git add evals/baseline.json   # review the score changes in the PR
```

Until `baseline.json` exists, the check prints a warning and passes.

## CloudWatch alerts

Scheduled and manual runs can publish every score, plus a `DriftDetected` metric (1 or 0), to CloudWatch namespace `LLMEval/CaseAIAgent`. [`Backend/terraform_code/eval_monitoring.tf`](../Backend/terraform_code/eval_monitoring.tf) creates:

- an **alarm** that fires when a run detects drift, and notifies an **SNS topic** (email, or Slack/PagerDuty subscribed to the topic)
- a **dashboard** with each score, error rate and latency over time
- an **IAM role** that GitHub Actions assumes through OIDC, allowed only `PutMetricData` in that namespace

Setup:

```bash
cd Backend/terraform_code
terraform apply -var admin_email=... -var ses_from_email=... \
  -var eval_alert_email=you@example.com   # confirm the email AWS sends you
terraform output -raw eval_role_arn       # save as the AWS_EVAL_ROLE_ARN GitHub secret
```

Pull request runs are never published, so unmerged changes can't set off the alarm. If your AWS account already has a GitHub OIDC provider, add `-var create_github_oidc_provider=false`.

To publish from your own machine: `python3 evals/drift_check.py evals/results/latest.json --cloudwatch-namespace LLMEval/CaseAIAgent` (uses boto3 if installed, otherwise the AWS CLI).

## Configuration

| Setting | Default | How to change |
|---|---|---|
| Model under test | `gpt-4o-mini` (the Lambda default) | `OPENAI_MODEL` env var |
| Judge model | `openai:chat:gpt-4o` | `EVAL_GRADER` env var (any promptfoo provider ID) |
| Drift tolerance | 0.05 | `drift_check.py --tolerance 0.03` |
| Fail on latency/token growth | Off | `drift_check.py --fail-on-cost` |

## Files

| File | Purpose |
|---|---|
| `promptfooconfig.yaml` | Eval definition: prompt, provider, judge, shared assertions |
| `tests.yaml` | Golden dataset with expected decisions, priorities and rubrics |
| `provider.js` | Promptfoo provider that calls the real `agent.js` logic |
| `drift_check.py` | Baseline comparison and report (standard library only) |
| `baseline.json` | Saved scores from the last accepted run (create with `--update-baseline`) |
