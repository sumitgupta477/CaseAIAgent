# MSAIAgentPOC

AI Agent POC for MS - answers all AI questions and creates Case for all problems/issues/tickets



FrontEnd:

1. Change the api url in frontend to the apigateway url.
2. Install the frontend app on vercel



Backend:

1. Create an AWS account
2. Download and install AWS cli, and configure with your iam admin service credentials and us-east-1 region
3. Download and install terraform
4. Run the terraform code
5. Enable your domain/gmail email on SES
6. Enable the stage on API Gateway and do autodeploy and enable the cors
7. make sure to put the correct openAI key in the lambda code
8. Make sure to install the npm dependencies for Backend\terraform_code\backend\submit.js file

## System Architecture

![Architecture](Diagrams/Diagram_Correct.png)



