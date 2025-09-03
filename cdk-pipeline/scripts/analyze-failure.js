const fs = require('fs');
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const stringify = require('json-stable-stringify');

async function analyzeFailure() {
    try {
        // Get environment variables
        const pipelineName = process.env.PIPELINE_NAME;
        const executionId = process.env.EXECUTION_ID;
        const failedStage = process.env.FAILED_STAGE;
        const failedAction = process.env.FAILED_ACTION;

        // Read pipeline execution details
        const pipelineExecution = fs.existsSync('pipeline_execution.json') 
            ? JSON.parse(fs.readFileSync('pipeline_execution.json', 'utf8'))
            : {};

        // Initialize Bedrock client
        const client = new BedrockRuntimeClient({ region: 'us-east-1' });

        const bedrockRequest = {
            modelId: "anthropic.claude-3-haiku-20240307-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 2000,
                temperature: 0,
                messages: [{
                    role: "user",
                    content: `As a DevOps expert, analyze this AWS CodePipeline failure and provide detailed recommendations. 
                    Format your response in two parts: a markdown report and a JSON summary.

                    Pipeline Details:
                    - Pipeline Name: ${pipelineName}
                    - Failed Stage: ${failedStage}
                    - Failed Action: ${failedAction}
                    - Execution ID: ${executionId}
                    
                    Execution Details:
                    ${stringify(pipelineExecution, { space: 2 })}

                    Provide your analysis in exactly this format:

                    <START_MARKDOWN>
                    # Pipeline Failure Analysis Report
                    Generated: ${new Date().toISOString()}

                    ## Pipeline Details
                    - Pipeline: ${pipelineName}
                    - Failed Stage: ${failedStage}
                    - Failed Action: ${failedAction}
                    - Execution ID: ${executionId}

                    ## Root Cause Analysis
                    [List root causes]

                    ## Impact Assessment
                    [List impacts]

                    ## Immediate Fix Steps
                    [List immediate fix steps]

                    ## Long-term Recommendations
                    [List long-term recommendations]

                    ## Prevention Strategies
                    [List prevention strategies]

                    ## Summary
                    Severity: [CRITICAL|MODERATE|LOW]
                    <END_MARKDOWN>

                    <START_JSON>
                    {
                      "timestamp": "${new Date().toISOString()}",
                      "summary": {
                        "severity": "CRITICAL|MODERATE|LOW",
                        "analysisVersion": "1.0"
                      },
                      "analysis": {
                        "rootCause": [],
                        "impact": [],
                        "immediateFix": [],
                        "longTermFix": [],
                        "prevention": []
                      }
                    }
                    <END_JSON>`
                }]
            })
        };

        console.log('Calling Bedrock for analysis...');
        const command = new InvokeModelCommand(bedrockRequest);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (!responseBody?.content?.[0]?.text) {
            throw new Error('Invalid response from Bedrock');
        }

        const responseText = responseBody.content[0].text;

        // Extract markdown content
        const markdownMatch = responseText.match(/<START_MARKDOWN>([\s\S]*?)<END_MARKDOWN>/);
        if (!markdownMatch) {
            throw new Error('Could not extract markdown content from response');
        }
        const markdownContent = markdownMatch[1].trim();

        // Extract JSON content
        const jsonMatch = responseText.match(/<START_JSON>([\s\S]*?)<END_JSON>/);
        if (!jsonMatch) {
            throw new Error('Could not extract JSON content from response');
        }

        // Parse JSON analysis
        let analysisJson;
        try {
            analysisJson = JSON.parse(jsonMatch[1].trim());
        } catch (e) {
            throw new Error('Invalid JSON analysis format in response');
        }

        // Save all outputs
        fs.writeFileSync('failure_analysis.md', markdownContent);
        fs.writeFileSync('failure_analysis.json', stringify(analysisJson, { space: 2 }));

        console.log('Failure analysis completed successfully');

    } catch (error) {
        console.error('Error in failure analysis:', error);
        
        const errorReport = `# Pipeline Failure Analysis Error Report\n\nError: ${error.message}\nTimestamp: ${new Date().toISOString()}`;
        fs.writeFileSync('failure_analysis.md', errorReport);
        fs.writeFileSync('failure_analysis.json', stringify({
            error: error.message,
            timestamp: new Date().toISOString()
        }, { space: 2 }));
        
        process.exit(1);
    }
}

analyzeFailure();
