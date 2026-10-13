# Run `npm ci` in ./backend before `terraform apply` so dependencies are packaged.
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/backend"
  output_path = "${path.module}/build/lambda.zip"
}

resource "aws_lambda_function" "api" {
  function_name    = "ai-case-api"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  handler     = "submit.handler"
  runtime     = "nodejs20.x"
  role        = aws_iam_role.lambda_role.arn
  timeout     = 30
  memory_size = 256

  environment {
    variables = {
      CASES_TABLE       = aws_dynamodb_table.cases.name
      ADMIN_EMAIL       = var.admin_email
      SES_FROM          = var.ses_from_email
      OPENAI_SECRET_ARN = aws_secretsmanager_secret.openai_api_key.arn
      OPENAI_MODEL      = var.openai_model
    }
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 14
}

# The OpenAI API key lives in Secrets Manager, not in code or Terraform state.
# Set its value once after apply (see README).
resource "aws_secretsmanager_secret" "openai_api_key" {
  name_prefix = "ai-case-agent/openai-api-key-"
  description = "OpenAI API key used by the AI Case Agent Lambda"
}

resource "aws_ses_email_identity" "sender" {
  email = var.ses_from_email
}
