# Simple CDK App

A basic AWS CDK application that creates:
- An S3 bucket with versioning enabled
- A Lambda function that returns a simple JSON response
- An API Gateway that exposes the Lambda function

## Prerequisites

- Node.js (v16 or later)
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Bootstrap CDK (first time only):
   ```bash
   cdk bootstrap
   ```

## Deployment

1. Build the project:
   ```bash
   npm run build
   ```

2. Deploy the stack:
   ```bash
   cdk deploy
   ```

3. The deployment will output:
   - API Gateway URL
   - S3 Bucket name

## Testing

Visit the API Gateway URL in your browser or use curl:
```bash
curl [API_GATEWAY_URL]
```

## Cleanup

To remove all resources:
```bash
cdk destroy
```

## Project Structure

- `bin/app.ts` - CDK app entry point
- `lib/simple-cdk-stack.ts` - Stack definition with resources
- `cdk.json` - CDK configuration
- `package.json` - Node.js dependencies and scripts