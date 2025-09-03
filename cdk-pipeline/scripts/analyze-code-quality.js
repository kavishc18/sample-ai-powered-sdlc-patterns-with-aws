const fs = require('fs');
const path = require('path');
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const stringify = require('json-stable-stringify');

async function analyzeCodeQuality() {
    try {
        console.log('Starting code quality analysis...');
        console.log('Current directory:', process.cwd());

        // Read templates from the templates directory
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

        // Combine all templates into a single object
        const combinedTemplate = {
            Templates: templates.reduce((acc, template) => {
                acc[template.name] = template.content;
                return acc;
            }, {})
        };

        // Generate report
        console.log('Analyzing combined templates...');
        const analysis = await callBedrock(combinedTemplate);

        let overallReport = '# Application Code Quality Analysis Report\n\n';
        overallReport += `Generated: ${new Date().toISOString()}\n\n`;
        overallReport += analysis;

        // Write report
        const reportPath = 'code_quality_report.md';
        fs.writeFileSync(reportPath, overallReport);
        console.log(`Analysis report generated successfully at: ${reportPath}`);
        console.log('Report content:');
        console.log(overallReport);

    } catch (error) {
        console.error('Error in code quality analysis:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

async function callBedrock(combinedTemplate) {
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    const bedrockRequest = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4000,
            messages: [{
                role: "user",
                content: `Analyze this set of AWS CloudFormation templates for an application stack. Provide a comprehensive quality analysis focusing on architecture, security, and best practices across all templates:

Combined Templates:
${stringify(combinedTemplate, { space: 2 })}

Please provide a holistic analysis covering:

1. Overall Stack Overview
- High-level architecture and design patterns
- Resource relationships and dependencies across templates
- Service integrations and their purposes

2. Comprehensive Quality Assessment
- Resource configurations and their consistency across templates
- Security settings and potential vulnerabilities
- Error handling and resilience strategies
- Scalability and performance considerations

3. Best Practices Review
- Alignment with AWS Well-Architected Framework
- Infrastructure as Code patterns and template structure
- Consistency in resource naming and tagging across templates
- Security best practices implementation

4. Recommendations
- High-priority improvements for the overall stack
- Security enhancements across all templates
- Performance and scalability optimizations
- Cost optimization opportunities

5. Cross-template Considerations
- Consistency and standardization across templates
- Potential for consolidation or modularization
- Inter-template dependencies and potential issues

Format your response as a clear, comprehensive markdown report with specific examples and actionable recommendations that consider the entire application stack across all templates.`
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

    return responseBody.content[0].text;
}

// Run the analysis
analyzeCodeQuality().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
