import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class SimpleCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an S3 bucket
    const bucket = new s3.Bucket(this, 'SimpleBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create a Lambda function
    const helloFunction = new lambda.Function(this, 'HelloFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              message: 'Hello from CDK Lambda!',
              timestamp: new Date().toISOString(),
              bucketName: '${bucket.bucketName}'
            })
          };
        };
      `),
    });

    // Grant the Lambda function read access to the S3 bucket
    bucket.grantRead(helloFunction);

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'SimpleApi', {
      restApiName: 'Simple CDK API',
      description: 'A simple API Gateway created with CDK',
    });

    const helloIntegration = new apigateway.LambdaIntegration(helloFunction);
    api.root.addMethod('GET', helloIntegration);

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    // Output the bucket name
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'S3 Bucket Name',
    });
  }
}