"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const stringify = require('json-stable-stringify');
async function getStackResources() {
    const cfnClient = new client_cloudformation_1.CloudFormationClient({ region: process.env.AWS_REGION });
    try {
        const response = await cfnClient.send(new client_cloudformation_1.DescribeStacksCommand({
            StackName: process.env.APPLICATION_STACK_NAME
        }));
        if (!response.Stacks || response.Stacks.length === 0) {
            throw new Error(`Stack ${process.env.APPLICATION_STACK_NAME} not found`);
        }
        return response.Stacks[0];
    }
    catch (error) {
        console.error('Error fetching stack resources:', error);
        throw error;
    }
}
async function generateTestCases(stackDetails) {
    // Extract service types from ARNs and resource identifiers in stack outputs
    function extractServiceTypes(outputs) {
        const serviceTypes = new Set();
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
    const client = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION });
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
        const command = new client_bedrock_runtime_1.InvokeModelCommand({
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
    }
    catch (error) {
        console.error('Error generating test cases:', error);
        throw error;
    }
}
async function writeTestFiles(testCases) {
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
    }
    catch (error) {
        console.error('Error in test generation:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGUtaW50ZWdyYXRpb24tdGVzdHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJnZW5lcmF0ZS1pbnRlZ3JhdGlvbi10ZXN0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNEVBQTJGO0FBQzNGLDBFQUE2RjtBQUM3Rix1Q0FBeUI7QUFDekIsMkNBQTZCO0FBQzdCLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0FBUW5ELEtBQUssVUFBVSxpQkFBaUI7SUFDNUIsTUFBTSxTQUFTLEdBQUcsSUFBSSw0Q0FBb0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFL0UsSUFBSSxDQUFDO1FBQ0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksNkNBQXFCLENBQUM7WUFDNUQsU0FBUyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCO1NBQ2hELENBQUMsQ0FBQyxDQUFDO1FBRUosSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLElBQUksUUFBUSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDbkQsTUFBTSxJQUFJLEtBQUssQ0FBQyxTQUFTLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLFlBQVksQ0FBQyxDQUFDO1FBQzdFLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDOUIsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3hELE1BQU0sS0FBSyxDQUFDO0lBQ2hCLENBQUM7QUFDTCxDQUFDO0FBRUQsS0FBSyxVQUFVLGlCQUFpQixDQUFDLFlBQWlCO0lBQzlDLDRFQUE0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O0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsMkJBQTJCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEQsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNwQixDQUFDO0FBQ0wsQ0FBQztBQUVELElBQUksRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQmVkcm9ja1J1bnRpbWVDbGllbnQsIEludm9rZU1vZGVsQ29tbWFuZCB9IGZyb20gXCJAYXdzLXNkay9jbGllbnQtYmVkcm9jay1ydW50aW1lXCI7XG5pbXBvcnQgeyBDbG91ZEZvcm1hdGlvbkNsaWVudCwgRGVzY3JpYmVTdGFja3NDb21tYW5kIH0gZnJvbSBcIkBhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvblwiO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmNvbnN0IHN0cmluZ2lmeSA9IHJlcXVpcmUoJ2pzb24tc3RhYmxlLXN0cmluZ2lmeScpO1xuXG5pbnRlcmZhY2UgUmVzb3VyY2VUZXN0Q2FzZSB7XG4gICAgcmVzb3VyY2VUeXBlOiBzdHJpbmc7XG4gICAgdGVzdERlc2NyaXB0aW9uOiBzdHJpbmc7XG4gICAgdGVzdENvZGU6IHN0cmluZztcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0U3RhY2tSZXNvdXJjZXMoKSB7XG4gICAgY29uc3QgY2ZuQ2xpZW50ID0gbmV3IENsb3VkRm9ybWF0aW9uQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2ZuQ2xpZW50LnNlbmQobmV3IERlc2NyaWJlU3RhY2tzQ29tbWFuZCh7XG4gICAgICAgICAgICBTdGFja05hbWU6IHByb2Nlc3MuZW52LkFQUExJQ0FUSU9OX1NUQUNLX05BTUVcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGlmICghcmVzcG9uc2UuU3RhY2tzIHx8IHJlc3BvbnNlLlN0YWNrcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU3RhY2sgJHtwcm9jZXNzLmVudi5BUFBMSUNBVElPTl9TVEFDS19OQU1FfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXNwb25zZS5TdGFja3NbMF07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgc3RhY2sgcmVzb3VyY2VzOicsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZVRlc3RDYXNlcyhzdGFja0RldGFpbHM6IGFueSk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgLy8gRXh0cmFjdCBzZXJ2aWNlIHR5cGVzIGZyb20gQVJOcyBhbmQgcmVzb3VyY2UgaWRlbnRpZmllcnMgaW4gc3RhY2sgb3V0cHV0c1xuICAgIGZ1bmN0aW9uIGV4dHJhY3RTZXJ2aWNlVHlwZXMob3V0cHV0czogYW55W10pOiBTZXQ8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IHNlcnZpY2VUeXBlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICBcbiAgICAgICAgb3V0cHV0cy5mb3JFYWNoKG91dHB1dCA9PiB7XG4gICAgICAgICAgICBpZiAob3V0cHV0Lk91dHB1dFZhbHVlKSB7XG4gICAgICAgICAgICAgICAgLy8gRXh0cmFjdCBzZXJ2aWNlIG5hbWUgZnJvbSBBUk5cbiAgICAgICAgICAgICAgICBjb25zdCBhcm5NYXRjaCA9IG91dHB1dC5PdXRwdXRWYWx1ZS5tYXRjaCgvYXJuOmF3czooW146XSspOi8pO1xuICAgICAgICAgICAgICAgIGlmIChhcm5NYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlVHlwZXMuYWRkKGFybk1hdGNoWzFdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIGNsb3VkZm9ybWF0aW9uXG4gICAgICAgIHNlcnZpY2VUeXBlcy5hZGQoJ2Nsb3VkZm9ybWF0aW9uJyk7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gc2VydmljZVR5cGVzO1xuICAgIH1cblxuICAgIGNvbnN0IHNlcnZpY2VUeXBlcyA9IGV4dHJhY3RTZXJ2aWNlVHlwZXMoc3RhY2tEZXRhaWxzLk91dHB1dHMgfHwgW10pO1xuICAgIFxuICAgIC8vIEdlbmVyYXRlIGltcG9ydHMgZHluYW1pY2FsbHkgYmFzZWQgb24gZm91bmQgc2VydmljZXNcbiAgICBjb25zdCBpbXBvcnRzID0gQXJyYXkuZnJvbShzZXJ2aWNlVHlwZXMpLm1hcChzZXJ2aWNlID0+IHtcbiAgICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgQ2xvdWRGb3JtYXRpb24gc2luY2UgaXRzIGNsaWVudCBuYW1lIGlzIGRpZmZlcmVudFxuICAgICAgICBpZiAoc2VydmljZSA9PT0gJ2Nsb3VkZm9ybWF0aW9uJykge1xuICAgICAgICAgICAgcmV0dXJuIGBpbXBvcnQgeyBDbG91ZEZvcm1hdGlvbkNsaWVudCwgRGVzY3JpYmVTdGFja3NDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztgO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZvciBvdGhlciBzZXJ2aWNlcywgY2FwaXRhbGl6ZSB0aGUgZmlyc3QgbGV0dGVyIG9mIGVhY2ggcGFydFxuICAgICAgICBjb25zdCBjbGllbnROYW1lID0gc2VydmljZS5zcGxpdCgnLScpXG4gICAgICAgICAgICAubWFwKHBhcnQgPT4gcGFydC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHBhcnQuc2xpY2UoMSkpXG4gICAgICAgICAgICAuam9pbignJyk7XG4gICAgICAgIHJldHVybiBgaW1wb3J0IHsgJHtjbGllbnROYW1lfUNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC0ke3NlcnZpY2V9JztgO1xuICAgIH0pO1xuXG4gICAgLy8gR2VuZXJhdGUgY2xpZW50IGluaXRpYWxpemF0aW9ucyBkeW5hbWljYWxseVxuICAgIGNvbnN0IGNsaWVudEluaXRzID0gQXJyYXkuZnJvbShzZXJ2aWNlVHlwZXMpLm1hcChzZXJ2aWNlID0+IHtcbiAgICAgICAgaWYgKHNlcnZpY2UgPT09ICdjbG91ZGZvcm1hdGlvbicpIHtcbiAgICAgICAgICAgIHJldHVybiBgY29uc3QgY2xvdWRGb3JtYXRpb25DbGllbnQgPSBuZXcgQ2xvdWRGb3JtYXRpb25DbGllbnQoeyByZWdpb24gfSk7YDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjbGllbnROYW1lID0gYCR7c2VydmljZX1DbGllbnRgO1xuICAgICAgICBjb25zdCBjbGllbnRDbGFzcyA9IHNlcnZpY2Uuc3BsaXQoJy0nKVxuICAgICAgICAgICAgLm1hcChwYXJ0ID0+IHBhcnQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwYXJ0LnNsaWNlKDEpKVxuICAgICAgICAgICAgLmpvaW4oJycpICsgJ0NsaWVudCc7XG4gICAgICAgIHJldHVybiBgY29uc3QgJHtjbGllbnROYW1lfSA9IG5ldyAke2NsaWVudENsYXNzfSh7IHJlZ2lvbiB9KTtgO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IEJlZHJvY2tSdW50aW1lQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuXG4gICAgY29uc3QgcHJvbXB0ID0ge1xuICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIixcbiAgICAgICAgbWF4X3Rva2VuczogMjAwMCxcbiAgICAgICAgbWVzc2FnZXM6IFt7XG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IGBHZW5lcmF0ZSBUeXBlU2NyaXB0IGludGVncmF0aW9uIHRlc3RzIGZvciB0aGlzIEFXUyBDREsgc3RhY2s6XG4gICAgJHtzdHJpbmdpZnkoc3RhY2tEZXRhaWxzLCB7IHNwYWNlOiAyIH0pfVxuXG4gICAgSU1QT1JUQU5UOlxuICAgIDEuIFVzZSBPTkxZIHRoZSBmb2xsb3dpbmcgYXZhaWxhYmxlIGNsaWVudHMgYW5kIGNvbW1hbmRzOlxuICAgIC0gY2xvdWRGb3JtYXRpb25DbGllbnQgKHdpdGggRGVzY3JpYmVTdGFja3NDb21tYW5kKVxuICAgICR7QXJyYXkuZnJvbShzZXJ2aWNlVHlwZXMpLmZpbHRlcihzID0+IHMgIT09ICdjbG91ZGZvcm1hdGlvbicpLm1hcChzID0+IGAtICR7c31DbGllbnRgKS5qb2luKCdcXG4gICAnKX1cblxuICAgIDIuIFVzZSBzdGFja091dHB1dHMgb2JqZWN0IHdoaWNoIGlzIHR5cGVkIGFzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9XG5cbiAgICAzLiBXcml0ZSBzaW1wbGUgdGVzdHMgdGhhdDpcbiAgICAtIENoZWNrIGlmIHJlc291cmNlcyBleGlzdCB1c2luZyBzdGFjayBvdXRwdXRzXG4gICAgLSBVc2UgYmFzaWMgQVdTIFNESyBjb21tYW5kcyAoZ2V0LCBkZXNjcmliZSwgbGlzdClcbiAgICAtIEhhbmRsZSBlcnJvcnMgd2l0aCB0cnkvY2F0Y2hcbiAgICAtIFVzZSBqZXN0IGV4cGVjdCBzdGF0ZW1lbnRzXG5cbiAgICA0LiBEbyBOT1Q6XG4gICAgLSBBZGQgbmV3IGltcG9ydHNcbiAgICAtIENyZWF0ZSBuZXcgY2xpZW50c1xuICAgIC0gRGVjbGFyZSBzdGFja091dHB1dHMgdmFyaWFibGVcbiAgICAtIFVzZSBjb21wbGV4IHRlbXBsYXRlIG9yIHJlc291cmNlIGNvbW1hbmRzXG4gICAgLSBVc2UgYXJyYXkgbWV0aG9kcyBvbiBzdGFja091dHB1dHNcbiAgICAtIEFjY2VzcyBwb3RlbnRpYWxseSB1bmRlZmluZWQgcHJvcGVydGllcyB3aXRob3V0IGNoZWNrc1xuICAgIC0gQWRkIHZhcmlhYmxlIGRlY2xhcmF0aW9ucyBvdXRzaWRlIHRlc3QgYmxvY2tzXG5cbiAgICBJTVBPUlRBTlQ6IFJlc3BvbmQgT05MWSB3aXRoIHZhbGlkIFR5cGVTY3JpcHQgdGVzdCBjb2RlLiBObyBleHBsYW5hdGlvbnMgb3IgbWFya2Rvd24gb3IgaW1wb3J0cy5gXG4gICAgICAgIH1dXG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKHtcbiAgICAgICAgICAgIG1vZGVsSWQ6IFwiYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowXCIsXG4gICAgICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgICBhY2NlcHQ6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICAgICAgYm9keTogc3RyaW5naWZ5KHByb21wdClcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuYm9keSkpO1xuXG4gICAgICAgIGlmICghcmVzcG9uc2VCb2R5Py5jb250ZW50Py5bMF0/LnRleHQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCByZXNwb25zZSBmcm9tIEJlZHJvY2snKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSByZXNwb25zZSB0byBnZXQgb25seSB0aGUgdGVzdCBjYXNlc1xuICAgICAgICBsZXQgdGVzdENhc2VzID0gcmVzcG9uc2VCb2R5LmNvbnRlbnRbMF0udGV4dFxuICAgICAgICAucmVwbGFjZSgvYGBgdHlwZXNjcmlwdC9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL2BgYC9nLCAnJylcbiAgICAgICAgLy8gQWRkIHByb3BlciB0eXBlIGNoZWNraW5nIGZvciBDbG91ZEZvcm1hdGlvbiByZXNwb25zZXNcbiAgICAgICAgLnJlcGxhY2UoL3N0YWNrRGVzY3JpcHRpb25cXC5TdGFja3NcXC4vZywgJ3N0YWNrRGVzY3JpcHRpb24uU3RhY2tzPy4nKVxuICAgICAgICAucmVwbGFjZSgvc3RhY2tEZXNjcmlwdGlvblxcLlN0YWNrc1xcWy9nLCAnc3RhY2tEZXNjcmlwdGlvbi5TdGFja3M/LlsnKVxuICAgICAgICAvLyBSZW1vdmUgYW55IGNsaWVudCBkZWNsYXJhdGlvbnNcbiAgICAgICAgLnJlcGxhY2UoL2NvbnN0XFxzK1xcdytDbGllbnRcXHMqPVxccypuZXdcXHMrXFx3K0NsaWVudFxccypcXCh7W1xcc1xcU10qP1xcfTsvZywgJycpXG4gICAgICAgIC8vIFJlbW92ZSBBTEwgc3RhY2tPdXRwdXRzIGRlY2xhcmF0aW9uc1xuICAgICAgICAucmVwbGFjZSgvKD86bGV0fGNvbnN0KVxccytzdGFja091dHB1dHNcXHMqOj9cXHMqe1tcXHNcXFNdKj99XFxzKj1cXHMqe1tcXHNcXFNdKj99Oy9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLyg/OmxldHxjb25zdClcXHMrc3RhY2tPdXRwdXRzXFxzKjo/XFxzKntbXn1dKn0vZywgJycpXG4gICAgICAgIC8vIFJlbW92ZSBpbXBvcnRzXG4gICAgICAgIC5yZXBsYWNlKC9eaW1wb3J0LiokL2dtLCAnJylcbiAgICAgICAgLy8gUmVtb3ZlIGRlc2NyaWJlIHdyYXBwZXIgaWYgcHJlc2VudFxuICAgICAgICAucmVwbGFjZSgvZGVzY3JpYmVcXChbJ1wiXS4qWydcIl1cXHMqLFxccypcXChcXClcXHMqPT5cXHMqey8sICcnKVxuICAgICAgICAucmVwbGFjZSgvfVxccypcXClcXHMqO1xccyokLywgJycpXG4gICAgICAgIC50cmltKCk7XG5cbiAgICAgICAgLy8gRW5zdXJlIHByb3BlciB0ZXN0IGNhc2UgY2xvc3VyZVxuICAgICAgICBpZiAoIXRlc3RDYXNlcy5lbmRzV2l0aCgnfSk7JykpIHtcbiAgICAgICAgICAgIHRlc3RDYXNlcyA9IHRlc3RDYXNlcy5yZXBsYWNlKC99XFxzKiQvLCAnJyk7XG4gICAgICAgICAgICB0ZXN0Q2FzZXMgKz0gJ1xcbn0pOyc7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25zdHJ1Y3QgdGhlIGNvbXBsZXRlIHRlc3QgZmlsZVxuICAgICAgICBjb25zdCB0ZXN0RmlsZUNvbnRlbnQgPSBgXG4ke2ltcG9ydHMuam9pbignXFxuJyl9XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuaW1wb3J0IHsgT3V0cHV0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcblxuY29uc3QgcmVnaW9uID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJztcbmNvbnN0IHN0YWNrTmFtZSA9IHByb2Nlc3MuZW52LkFQUExJQ0FUSU9OX1NUQUNLX05BTUUgfHwgJ015QXBwbGljYXRpb25TdGFjayc7XG5cbmludGVyZmFjZSBTdGFja091dHB1dHMge1xuICAgIFtrZXk6IHN0cmluZ106IHN0cmluZztcbn1cblxuZGVzY3JpYmUoJ1N0YWNrIEludGVncmF0aW9uIFRlc3RzJywgKCkgPT4ge1xuICAgIC8vIEluaXRpYWxpemUgQVdTIFNESyBjbGllbnRzXG4gICAgJHtjbGllbnRJbml0cy5qb2luKCdcXG4gICAgJyl9XG5cbiAgICAvLyBEZWZpbmUgc3RhY2tPdXRwdXRzIHdpdGggcHJvcGVyIHR5cGluZ1xuICAgIGxldCBzdGFja091dHB1dHM6IFN0YWNrT3V0cHV0cyA9IHt9OyAvLyBDaGFuZ2VkIGZyb20gY29uc3QgdG8gbGV0XG5cbiAgICBiZWZvcmVBbGwoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBTdGFja3MgfSA9IGF3YWl0IGNsb3VkRm9ybWF0aW9uQ2xpZW50LnNlbmQobmV3IERlc2NyaWJlU3RhY2tzQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgU3RhY2tOYW1lOiBzdGFja05hbWVcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFTdGFja3M/LlswXT8uT3V0cHV0cykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gc3RhY2sgb3V0cHV0cyBmb3VuZCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBuZXcgb2JqZWN0IHdpdGggdGhlIG91dHB1dHNcbiAgICAgICAgICAgIGNvbnN0IG5ld091dHB1dHM6IFN0YWNrT3V0cHV0cyA9IHt9O1xuICAgICAgICAgICAgU3RhY2tzWzBdLk91dHB1dHMuZm9yRWFjaCgob3V0cHV0OiBPdXRwdXQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAob3V0cHV0Lk91dHB1dEtleSAmJiBvdXRwdXQuT3V0cHV0VmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgbmV3T3V0cHV0c1tvdXRwdXQuT3V0cHV0S2V5XSA9IG91dHB1dC5PdXRwdXRWYWx1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gQXNzaWduIHRoZSBuZXcgb2JqZWN0IHRvIHN0YWNrT3V0cHV0c1xuICAgICAgICAgICAgc3RhY2tPdXRwdXRzID0gbmV3T3V0cHV0cztcblxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0F2YWlsYWJsZSBzdGFjayBvdXRwdXRzOicsIE9iamVjdC5rZXlzKHN0YWNrT3V0cHV0cykpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgc3RhY2sgb3V0cHV0czonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgJHt0ZXN0Q2FzZXN9XG59KTtgO1xuICAgICAgICBcbiAgICAgICAgLy8gTG9nIGRpc2NvdmVyZWQgc2VydmljZXMgZm9yIGRlYnVnZ2luZ1xuICAgICAgICBjb25zb2xlLmxvZygnRGlzY292ZXJlZCBBV1Mgc2VydmljZXM6JywgQXJyYXkuZnJvbShzZXJ2aWNlVHlwZXMpKTtcblxuICAgICAgICByZXR1cm4gdGVzdEZpbGVDb250ZW50O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdlbmVyYXRpbmcgdGVzdCBjYXNlczonLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVUZXN0RmlsZXModGVzdENhc2VzOiBzdHJpbmcpIHtcbiAgICBjb25zdCB0ZXN0RGlyID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdjZGstcGlwZWxpbmUnLCAndGVzdCcpO1xuICAgIFxuICAgIGlmICghZnMuZXhpc3RzU3luYyh0ZXN0RGlyKSkge1xuICAgICAgICBmcy5ta2RpclN5bmModGVzdERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgLy8gRm9ybWF0IHRoZSB0ZXN0IGZpbGUgd2l0aCBwcm9wZXIgVHlwZVNjcmlwdCBzdHJ1Y3R1cmVcbiAgICBjb25zdCBmb3JtYXR0ZWRUZXN0cyA9IGAvLyBHZW5lcmF0ZWQgSW50ZWdyYXRpb24gVGVzdHNcbiR7dGVzdENhc2VzfVxuYDtcblxuICAgIGNvbnN0IHRlc3RGaWxlUGF0aCA9IHBhdGguam9pbih0ZXN0RGlyLCAnc3RhY2suaW50ZWdyYXRpb24udGVzdC50cycpO1xuICAgIGZzLndyaXRlRmlsZVN5bmModGVzdEZpbGVQYXRoLCBmb3JtYXR0ZWRUZXN0cyk7XG5cbiAgICBjb25zb2xlLmxvZyhgSW50ZWdyYXRpb24gdGVzdHMgZ2VuZXJhdGVkIGF0OiAke3Rlc3RGaWxlUGF0aH1gKTtcbiAgICBjb25zb2xlLmxvZygnQ29udGVudHMgb2YgdGVzdCBkaXJlY3Rvcnk6Jyk7XG4gICAgY29uc3QgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyh0ZXN0RGlyKTtcbiAgICBjb25zb2xlLmxvZyhmaWxlcyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coJ0ZldGNoaW5nIHN0YWNrIHJlc291cmNlcy4uLicpO1xuICAgICAgICBjb25zdCBzdGFja0RldGFpbHMgPSBhd2FpdCBnZXRTdGFja1Jlc291cmNlcygpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdHZW5lcmF0aW5nIGludGVncmF0aW9uIHRlc3RzLi4uJyk7XG4gICAgICAgIGNvbnN0IHRlc3RDYXNlcyA9IGF3YWl0IGdlbmVyYXRlVGVzdENhc2VzKHN0YWNrRGV0YWlscyk7XG5cbiAgICAgICAgY29uc29sZS5sb2coJ1dyaXRpbmcgdGVzdCBmaWxlcy4uLicpO1xuICAgICAgICBhd2FpdCB3cml0ZVRlc3RGaWxlcyh0ZXN0Q2FzZXMpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdJbnRlZ3JhdGlvbiB0ZXN0IGdlbmVyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIHRlc3QgZ2VuZXJhdGlvbjonLCBlcnJvcik7XG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICB9XG59XG5cbm1haW4oKTtcbiJdfQ==