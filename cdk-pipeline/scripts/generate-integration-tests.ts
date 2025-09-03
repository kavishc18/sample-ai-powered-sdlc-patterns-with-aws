import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import * as fs from 'fs';
import * as path from 'path';
const stringify = require('json-stable-stringify');

interface ResourceTestCase {
    resourceType: string;
    testDescription: string;
    testCode: string;
}

async function getStackResources() {
    const cfnClient = new CloudFormationClient({ region: process.env.AWS_REGION });
    
    try {
        const response = await cfnClient.send(new DescribeStacksCommand({
            StackName: process.env.APPLICATION_STACK_NAME
        }));

        if (!response.Stacks || response.Stacks.length === 0) {
            throw new Error(`Stack ${process.env.APPLICATION_STACK_NAME} not found`);
        }

        return response.Stacks[0];
    } catch (error) {
        console.error('Error fetching stack resources:', error);
        throw error;
    }
}

async function generateTestCases(stackDetails: any): Promise<string> {
    // Extract service types from ARNs and resource identifiers in stack outputs
    function extractServiceTypes(outputs: any[]): Set<string> {
        const serviceTypes = new Set<string>();
        
        outputs.forEach(output => {
            if (output.OutputValue) {
                // Extract service name from ARN
                const arnMatch = output.OutputValue.match(/arn:aws:([^:]+):/);
                if (arnMatch) {
                    serviceTypes.add(arnMatch[1]);
                }
            }
        });

        // Always include cloudformation
        serviceTypes.add('cloudformation');
        
        return serviceTypes;
    }

    const serviceTypes = extractServiceTypes(stackDetails.Outputs || []);
    
    // Generate imports dynamically based on found services
    const imports = Array.from(serviceTypes).map(service => {
        // Special handling for CloudFormation since its client name is different
        if (service === 'cloudformation') {
            return `import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';`;
        }
        // For other services, capitalize the first letter of each part
        const clientName = service.split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
        return `import { ${clientName}Client } from '@aws-sdk/client-${service}';`;
    });

    // Generate client initializations dynamically
    const clientInits = Array.from(serviceTypes).map(service => {
        if (service === 'cloudformation') {
            return `const cloudFormationClient = new CloudFormationClient({ region });`;
        }
        const clientName = `${service}Client`;
        const clientClass = service.split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('') + 'Client';
        return `const ${clientName} = new ${clientClass}({ region });`;
    });

    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

    const prompt = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        messages: [{
            role: "user",
            content: `Generate TypeScript integration tests for this AWS CDK stack:
    ${stringify(stackDetails, { space: 2 })}

    IMPORTANT:
    1. Use ONLY the following available clients and commands:
    - cloudFormationClient (with DescribeStacksCommand)
    ${Array.from(serviceTypes).filter(s => s !== 'cloudformation').map(s => `- ${s}Client`).join('\n   ')}

    2. Use stackOutputs object which is typed as: { [key: string]: string }

    3. Write simple tests that:
    - Check if resources exist using stack outputs
    - Use basic AWS SDK commands (get, describe, list)
    - Handle errors with try/catch
    - Use jest expect statements

    4. Do NOT:
    - Add new imports
    - Create new clients
    - Declare stackOutputs variable
    - Use complex template or resource commands
    - Use array methods on stackOutputs
    - Access potentially undefined properties without checks
    - Add variable declarations outside test blocks

    IMPORTANT: Respond ONLY with valid TypeScript test code. No explanations or markdown or imports.`
        }]
    };

    try {
        const command = new InvokeModelCommand({
            modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: stringify(prompt)
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (!responseBody?.content?.[0]?.text) {
            throw new Error('Invalid response from Bedrock');
        }

        // Clean up the response to get only the test cases
        let testCases = responseBody.content[0].text
        .replace(/```typescript/g, '')
        .replace(/```/g, '')
        // Add proper type checking for CloudFormation responses
        .replace(/stackDescription\.Stacks\./g, 'stackDescription.Stacks?.')
        .replace(/stackDescription\.Stacks\[/g, 'stackDescription.Stacks?.[')
        // Remove any client declarations
        .replace(/const\s+\w+Client\s*=\s*new\s+\w+Client\s*\({[\s\S]*?\};/g, '')
        // Remove ALL stackOutputs declarations
        .replace(/(?:let|const)\s+stackOutputs\s*:?\s*{[\s\S]*?}\s*=\s*{[\s\S]*?};/g, '')
        .replace(/(?:let|const)\s+stackOutputs\s*:?\s*{[^}]*}/g, '')
        // Remove imports
        .replace(/^import.*$/gm, '')
        // Remove describe wrapper if present
        .replace(/describe\(['"].*['"]\s*,\s*\(\)\s*=>\s*{/, '')
        .replace(/}\s*\)\s*;\s*$/, '')
        .trim();

        // Ensure proper test case closure
        if (!testCases.endsWith('});')) {
            testCases = testCases.replace(/}\s*$/, '');
            testCases += '\n});';
        }

        // Construct the complete test file
        const testFileContent = `
${imports.join('\n')}
import axios from 'axios';
import { Output } from '@aws-sdk/client-cloudformation';

const region = process.env.AWS_REGION || 'us-east-1';
const stackName = process.env.APPLICATION_STACK_NAME || 'MyApplicationStack';

interface StackOutputs {
    [key: string]: string;
}

describe('Stack Integration Tests', () => {
    // Initialize AWS SDK clients
    ${clientInits.join('\n    ')}

    // Define stackOutputs with proper typing
    let stackOutputs: StackOutputs = {}; // Changed from const to let

    beforeAll(async () => {
        try {
            const { Stacks } = await cloudFormationClient.send(new DescribeStacksCommand({
                StackName: stackName
            }));
            
            if (!Stacks?.[0]?.Outputs) {
                throw new Error('No stack outputs found');
            }

            // Create a new object with the outputs
            const newOutputs: StackOutputs = {};
            Stacks[0].Outputs.forEach((output: Output) => {
                if (output.OutputKey && output.OutputValue) {
                    newOutputs[output.OutputKey] = output.OutputValue;
                }
            });

            // Assign the new object to stackOutputs
            stackOutputs = newOutputs;

            console.log('Available stack outputs:', Object.keys(stackOutputs));
        } catch (error) {
            console.error('Error fetching stack outputs:', error);
            throw error;
        }
    });

    ${testCases}
});`;
        
        // Log discovered services for debugging
        console.log('Discovered AWS services:', Array.from(serviceTypes));

        return testFileContent;
    } catch (error) {
        console.error('Error generating test cases:', error);
        throw error;
    }
}

async function writeTestFiles(testCases: string) {
    const testDir = path.join(process.cwd(), 'cdk-pipeline', 'test');
    
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    // Format the test file with proper TypeScript structure
    const formattedTests = `// Generated Integration Tests
${testCases}
`;

    const testFilePath = path.join(testDir, 'stack.integration.test.ts');
    fs.writeFileSync(testFilePath, formattedTests);

    console.log(`Integration tests generated at: ${testFilePath}`);
    console.log('Contents of test directory:');
    const files = fs.readdirSync(testDir);
    console.log(files);
}

async function main() {
    try {
        console.log('Fetching stack resources...');
        const stackDetails = await getStackResources();

        console.log('Generating integration tests...');
        const testCases = await generateTestCases(stackDetails);

        console.log('Writing test files...');
        await writeTestFiles(testCases);

        console.log('Integration test generation completed successfully');
    } catch (error) {
        console.error('Error in test generation:', error);
        process.exit(1);
    }
}

main();
