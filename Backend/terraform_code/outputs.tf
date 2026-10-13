output "api_url" {
  description = "Set this as NEXT_PUBLIC_API_URL in the frontend"
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/submit"
}

output "openai_secret_arn" {
  value = aws_secretsmanager_secret.openai_api_key.arn
}
