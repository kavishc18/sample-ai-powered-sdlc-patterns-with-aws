import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
const stringify = require('json-stable-stringify');

interface TestResults {
  output?: any;
  environment: {
    timestamp: string;
    nodeVersion: string;
    platform: string;
  };
  success: boolean;
  numFailedTests: number;
  numPassedTests: number;
  testResults: any[];
}

async function analyzeTestResults() {
    try {
        console.log('Starting integration test analysis...');

        // Read test results
        const testResults = getTestResults();
        console.log('Test results:', JSON.stringify(testResults, null, 2));

        // Generate analysis using Bedrock
        const analysis = await generateAnalysisWithBedrock(testResults);

        // Save report
        writeFileSync('integration_test_report.md', analysis);
        console.log('Test analysis report generated successfully');

    } catch (error) {
        console.error('Error analyzing test results:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

function getTestResults(): TestResults {
    try {
        // Gather test results and related information
        const testOutputFile = join(process.cwd(), 'test-results.json');
        const defaultResults: TestResults = {
            environment: {
                timestamp: new Date().toISOString(),
                nodeVersion: process.version,
                platform: process.platform
            },
            success: false,
            numFailedTests: 0,
            numPassedTests: 0,
            testResults: []
        };

        if (existsSync(testOutputFile)) {
            const fileContent = readFileSync(testOutputFile, 'utf8');
            const parsedResults = JSON.parse(fileContent);
            return {
                ...defaultResults,
                ...parsedResults,
                environment: {
                    ...defaultResults.environment,
                    ...parsedResults.environment
                }
            };
        }

        return defaultResults;

    } catch (error) {
        console.error('Error gathering test results:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function generateAnalysisWithBedrock(testResults: TestResults): Promise<string> {
    if (!process.env.AWS_REGION) {
        throw new Error('AWS_REGION environment variable is not set');
    }

    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    
    try {
        const bedrockRequest = {
            modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 2000,
                messages: [{
                    role: "user",
                    content: `Analyze these integration test results and provide insights:

Test Results:
${stringify(testResults, { space: 2 })}

Generate a detailed analysis with the following sections:

# Integration Test Analysis Report

## Summary
Brief overview of test execution and results

## Test Results
- Total tests run
- Passed tests
- Failed tests
- Error analysis

## Key Findings
- Major issues identified
- Pattern analysis
- Integration points affected

## Recommendations
- Immediate actions needed
- Areas needing investigation
- Potential improvements

## Technical Details
- Test environment
- Execution timestamp
- System information

Format the response as a clear markdown report focused on actionable insights and recommendations.`
                }]
            })
        };

        console.log('Calling Bedrock for test analysis...');
        const command = new InvokeModelCommand(bedrockRequest);
        const response = await client.send(command);
        
        if (!response.body) {
            throw new Error('Empty response from Bedrock');
        }

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (!responseBody?.content?.[0]?.text) {
            throw new Error('Invalid response structure from Bedrock');
        }

        return responseBody.content[0].text;

    } catch (error) {
        console.error('Error generating analysis with Bedrock:', error instanceof Error ? error.message : String(error));
        return generateFallbackReport(testResults, error);
    }
}

function generateFallbackReport(testResults: TestResults, error: unknown): string {
    return `# Integration Test Analysis Report

## Error
Failed to generate analysis: ${error instanceof Error ? error.message : String(error)}

## Test Results Summary
- Total Tests: ${testResults.numPassedTests + testResults.numFailedTests}
- Passed: ${testResults.numPassedTests}
- Failed: ${testResults.numFailedTests}
- Success: ${testResults.success ? 'Yes' : 'No'}

## Technical Details
- Timestamp: ${testResults.environment.timestamp}
- Node Version: ${testResults.environment.nodeVersion}
- Platform: ${testResults.environment.platform}
`;
}

// Run the analysis
analyzeTestResults().catch(error => {
    console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
