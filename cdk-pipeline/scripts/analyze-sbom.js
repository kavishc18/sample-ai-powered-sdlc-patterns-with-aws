const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const stringify = require('json-stable-stringify');

function processPackageData(sbomData) {
    // Extract and process only the essential information
    const artifacts = sbomData.artifacts || [];
    
    // Get unique packages with versions
    const packages = artifacts.map(a => ({
        name: a.name,
        version: a.version,
        type: a.type,
        licenses: a.licenses,
        purl: a.purl
    }));

    // Group by package type
    const packagesByType = packages.reduce((acc, pkg) => {
        acc[pkg.type] = acc[pkg.type] || [];
        acc[pkg.type].push(pkg);
        return acc;
    }, {});

    return {
        summary: {
            totalPackages: artifacts.length,
            packageTypes: Object.keys(packagesByType),
            descriptor: sbomData.descriptor
        },
        packagesByType: packagesByType,
        topPackages: packages.slice(0, 20) // Limit to top 20 packages
    };
}

async function analyzeSbom() {
    try {
        console.log('Starting SBOM analysis...');

        // Read the SBOM data
        console.log('Reading SBOM data...');
        const sbomData = JSON.parse(fs.readFileSync('sbom.json', 'utf8'));

        // Process SBOM data
        const processedData = processPackageData(sbomData);

        // Prepare Bedrock request
        const bedrockRequest = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 2000,
            messages: [{
                role: "user",
                content: `Analyze this Software Bill of Materials (SBOM) for security vulnerabilities and provide recommendations:

SBOM Summary:
${stringify(processedData.summary, { space: 2 })}

Top 20 Packages:
${stringify(processedData.topPackages, { space: 2 })}

Package Types and Counts:
${Object.entries(processedData.packagesByType).map(([type, pkgs]) => 
    `${type}: ${pkgs.length} packages`
).join('\n')}

Provide a detailed analysis including:
1. Component vulnerabilities and outdated packages across all detected languages and frameworks (focus on the top packages)
2. Security risks in dependencies, particularly for AWS CDK components and critical dependencies
3. License compliance issues and compatibility concerns
4. Best practices recommendations for the identified package types
5. Specific remediation steps for each identified issue
6. Version update recommendations for outdated packages

Format the response as a clear, actionable report with sections for different types of findings. Include specific package names, versions, and CVE identifiers where applicable.`
            }]
        };

        // Write request to file
        console.log('Writing Bedrock request to file...');
        fs.writeFileSync('bedrock-request.json', stringify(bedrockRequest));

        // Call Bedrock using the request file
        console.log('Calling Bedrock for analysis...');
        await execAsync(`aws bedrock-runtime invoke-model \
            --model-id anthropic.claude-3-haiku-20240307-v1:0 \
            --region us-east-1 \
            --content-type application/json \
            --accept application/json \
            --cli-binary-format raw-in-base64-out \
            --body fileb://bedrock-request.json \
            sbom-analysis.json`);

        // Read and parse Bedrock response
        console.log('Processing Bedrock response...');
        const analysisResponse = JSON.parse(fs.readFileSync('sbom-analysis.json', 'utf8'));
        const analysisContent = analysisResponse.content[0].text;

        // Generate final report
        const report = `# Software Bill of Materials (SBOM) Analysis Report

Generated: ${new Date().toISOString()}

${analysisContent}

## SBOM Summary
- Total Components: ${processedData.summary.totalPackages}
- Package Types: ${processedData.summary.packageTypes.join(', ')}
- Format: ${processedData.summary.descriptor?.name || 'Syft'} ${processedData.summary.descriptor?.version || ''}
- Generated: ${processedData.summary.descriptor?.timestamp || new Date().toISOString()}

## Package Distribution
${Object.entries(processedData.packagesByType).map(([type, pkgs]) => 
    `- ${type}: ${pkgs.length} packages`
).join('\n')}

## Next Steps
1. Review identified vulnerabilities
2. Implement recommended security fixes
3. Update outdated dependencies
4. Apply suggested best practices
5. Address license compliance issues
`;

        // Write report
        console.log('Writing analysis report...');
        fs.writeFileSync('sbom-analysis-report.md', report);
        console.log('Analysis report generated successfully');

        // Send report to SNS
        if (process.env.SNS_TOPIC_ARN) {
            console.log('Sending report to SNS...');
            await execAsync(`aws sns publish \
                --topic-arn "${process.env.SNS_TOPIC_ARN}" \
                --subject "SBOM Analysis Report" \
                --message file://sbom-analysis-report.md`);
            console.log('Report sent to SNS');
        }

    } catch (error) {
        console.error('Error in SBOM analysis:', error);
        // Write error to file for debugging
        fs.writeFileSync('sbom-analysis-error.log', stringify({
            error: error.message,
            stack: error.stack,
            time: new Date().toISOString()
        }, { space: 2 }));
        process.exit(1);
    }
}

// Run the analysis
analyzeSbom();
