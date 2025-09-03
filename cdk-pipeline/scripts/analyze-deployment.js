const fs = require('fs');
const path = require('path');
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const stringify = require('json-stable-stringify');

async function sendSnsNotification(topicArn, subject, messageContent) {
    const sns = new SNSClient({ region: process.env.AWS_REGION });
    try {
        await sns.send(new PublishCommand({
            TopicArn: topicArn,
            Subject: subject,
            Message: messageContent
        }));
        console.log('SNS notification sent successfully');
    } catch (error) {
        console.error('Error sending SNS notification:', error);
        throw error;
    }
}

function summarizeResources(resources) {
    const typeCounts = resources.reduce((acc, resource) => {
        acc[resource.type] = (acc[resource.type] || 0) + 1;
        return acc;
    }, {});

    return Object.entries(typeCounts).map(([type, count]) => `${type}: ${count}`);
}

function summarizeTemplate(template) {
    return {
        name: template.name,
        resourceCount: Object.keys(template.content.Resources || {}).length,
        resourceTypes: [...new Set(Object.values(template.content.Resources || {}).map(r => r.Type))],
        hasParameters: Object.keys(template.content.Parameters || {}).length > 0,
        hasOutputs: Object.keys(template.content.Outputs || {}).length > 0
    };
}

async function analyzeDeployment() {
    try {
        console.log("Starting deployment analysis...");
        console.log('AWS Region:', process.env.AWS_REGION);
        console.log('SNS Topic ARN:', process.env.SNS_TOPIC_ARN);
        
        const templatesDir = './templates';
        console.log('Reading templates from:', templatesDir);
        
        if (!fs.existsSync('./templates')) {
            throw new Error(`Templates directory not found at: ${templatesDir}`);
        }

        const templateFiles = fs.readdirSync('./templates')
            .filter(file => file.endsWith('.template.json'));
        
        const templates = [];
        for (const fileName of templateFiles) {
            // Validate filename to prevent path traversal
            if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
                continue; // Skip potentially malicious filenames
            }
            
            const resolvedPath = path.resolve('./templates', fileName);
            const baseDir = path.resolve('./templates');
            
            // Ensure the resolved path is within the templates directory
            if (!resolvedPath.startsWith(baseDir)) {
                continue; // Skip paths that escape the directory
            }
            
            templates.push({
                name: fileName,
                content: JSON.parse(fs.readFileSync('./templates/' + fileName, 'utf8'))
            });
        }

        if (templates.length === 0) {
            throw new Error('No template files found in templates directory');
        }

        let totalResources = [];
        let totalIamResources = [];
        let totalNetworkResources = [];

        templates.forEach(template => {
            const resources = Object.entries(template.content.Resources || {}).map(([name, resource]) => ({
                templateName: template.name,
                name,
                type: resource.Type,
                properties: resource.Properties
            }));

            totalResources.push(...resources);
            
            totalIamResources.push(...resources.filter(r => 
                r.type.startsWith('AWS::IAM::') || 
                (r.properties && r.properties.Role)
            ));

            totalNetworkResources.push(...resources.filter(r => 
                r.type.startsWith('AWS::EC2::') || 
                r.type.startsWith('AWS::VPC::')
            ));
        });

        const templateSummaries = templates.map(summarizeTemplate);
        const resourceSummary = summarizeResources(totalResources);

        const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

        const bedrockRequest = {
            modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 2000,
                temperature: 0,
                messages: [{
                    role: "user",
                    content: `\n\nHuman: Analyze this CloudFormation deployment summary and provide a comprehensive analysis.

                    Deployment Summary:
                    - Total Templates: ${templates.length}
                    - Total Resources: ${totalResources.length}
                    - IAM Resources: ${totalIamResources.length}
                    - Network Resources: ${totalNetworkResources.length}

                    Resource Type Summary:
                    ${resourceSummary.join('\n')}

                    Template Summaries:
                    ${stringify(templateSummaries, { space: 2 })}

                    Key Resource Types:
                    IAM: ${totalIamResources.map(r => r.type).join(', ')}
                    Network: ${totalNetworkResources.map(r => r.type).join(', ')}

                    Provide your response in exactly this format:

                    <START_MARKDOWN>
                    # Comprehensive Deployment Analysis Report
                    Generated: ${new Date().toISOString()}

                    ## Stack Overview
                    [Overall analysis of the complete stack]

                    ## Key Resources and Architecture
                    [Analysis of resources and architecture across all templates]

                    ## Security Assessment
                    [Comprehensive security analysis]

                    ## Scalability Analysis
                    [Overall scalability review]

                    ## Cost Optimization
                    [Complete cost analysis]

                    ## Best Practices Review
                    [Best practices review across all templates]

                    ## Deployment Risks
                    [Overall risk analysis]

                    ## Cross-Stack Dependencies
                    [Analysis of dependencies between templates]

                    ## Recommendations
                    [Key recommendations for the entire stack]
                    <END_MARKDOWN>

                    <START_JSON>
                    {
                    "analysis": {
                        "templateCount": ${templates.length},
                        "totalResourceCount": ${totalResources.length},
                        "securityRating": "HIGH|MEDIUM|LOW",
                        "riskLevel": "HIGH|MEDIUM|LOW",
                        "findings": {
                        "critical": [],
                        "high": [],
                        "medium": [],
                        "low": []
                        },
                        "recommendations": []
                    }
                    }
                    <END_JSON>`
                }]
            })
        };

        fs.writeFileSync('deployment_request.json', stringify(bedrockRequest, { space: 2 }));

        console.log('Calling Bedrock for analysis...');
        console.log('Request body:', stringify(bedrockRequest.body, { space: 2 }));

        const command = new InvokeModelCommand(bedrockRequest);
        let response;
        try {
            response = await client.send(command);
            fs.writeFileSync('full_response.json', stringify({
                status: response.$metadata.httpStatusCode,
                headers: response.headers,
                body: JSON.parse(new TextDecoder().decode(response.body))
            }, { space: 2 }));
        } catch (error) {
            console.error('Bedrock API error:', error);
            fs.writeFileSync('error_details.json', stringify(error, { space: 2 }));
            throw error;
        }

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log('Response structure:', stringify(responseBody, { space: 2 }));

        let responseText;
        if (responseBody.content && Array.isArray(responseBody.content)) {
            responseText = responseBody.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('\n');
        } else if (responseBody.completion) {
            responseText = responseBody.completion;
        } else {
            console.error('Unexpected response format:', stringify(responseBody));
            throw new Error('Invalid response format from Bedrock');
        }

        fs.writeFileSync('bedrock_response.json', stringify(responseBody, { space: 2 }));

        const markdownMatch = responseText.match(/<START_MARKDOWN>([\s\S]*?)<END_MARKDOWN>/);
        if (!markdownMatch) {
            console.error('Full response:', responseText);
            throw new Error('Could not extract markdown content from response');
        }
        const markdownContent = markdownMatch[1].trim();

        const jsonMatch = responseText.match(/<START_JSON>([\s\S]*?)<END_JSON>/);
        if (!jsonMatch) {
            throw new Error('Could not extract JSON content from response');
        }

        let analysisJson;
        try {
            analysisJson = JSON.parse(jsonMatch[1].trim());
        } catch (e) {
            throw new Error('Invalid JSON analysis format in response');
        }

        fs.writeFileSync('deployment_report.md', markdownContent);
        fs.writeFileSync('deployment_analysis.json', stringify({
            ...analysisJson,
            timestamp: new Date().toISOString()
        }, { space: 2 }));

        const templateSummary = {
            templateCount: templates.length,
            totalResourceCount: totalResources.length,
            resourceTypesByTemplate: templateSummaries,
            iamResourceCount: totalIamResources.length,
            networkResourceCount: totalNetworkResources.length,
            resourceTypeSummary: resourceSummary
        };
        fs.writeFileSync('template_summary.json', stringify(templateSummary, { space: 2 }));

        const topicArn = process.env.SNS_TOPIC_ARN;
        if (topicArn) {
            await sendSnsNotification(
                topicArn,
                'Deployment Analysis Report',
                markdownContent
            );
        }

        console.log('Deployment analysis completed successfully');

    } catch (error) {
        console.error('Error in deployment analysis:', error);
        
        const errorReport = `# Deployment Analysis Error Report\n\nError: ${error.message}\nTimestamp: ${new Date().toISOString()}`;
        fs.writeFileSync('deployment_report.md', errorReport);
        
        if (process.env.SNS_TOPIC_ARN) {
            try {
                await sendSnsNotification(
                    process.env.SNS_TOPIC_ARN,
                    'Deployment Analysis Error',
                    errorReport
                );
            } catch (snsError) {
                console.error('Failed to send error notification:', snsError);
            }
        }
        
        process.exit(1);
    }
}

analyzeDeployment();
