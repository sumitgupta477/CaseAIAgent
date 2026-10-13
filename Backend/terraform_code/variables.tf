variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "admin_email" {
  description = "Support team address that receives an email for every new case"
  type        = string
}

variable "ses_from_email" {
  description = "Sender address for case emails. Terraform registers it with SES; click the verification link AWS emails to it."
  type        = string
}

variable "openai_model" {
  type    = string
  default = "gpt-4o-mini"
}

variable "allowed_origins" {
  description = "Origins allowed to call the API from a browser (e.g. your Vercel URL)"
  type        = list(string)
  default     = ["*"]
}
