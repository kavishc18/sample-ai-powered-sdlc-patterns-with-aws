const fs = require('fs');
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const stringify = require('json-stable-stringify');

async function performSastAnalysis() {
    try {
        console.log("Starting SAST Analysis...");
        
        // Get environment variables
        const severityThreshold = process.env.SAST_SEVERITY_THRESHOLD || 'HIGH';
        const maxHighFindings = parseInt(process.env.SAST_MAX_HIGH_FINDINGS || '3');
        const maxMediumFindings = parseInt(process.env.SAST_MAX_MEDIUM_FINDINGS || '5');
        
        // Scan directories without using variables in fs operations
        const codeFiles = [];
        const scanDirectories = () => {
            // Scan lib directory - get file list first, then process individually
            try {
                if (fs.existsSync('./lib')) {
                    const libFiles = fs.readdirSync('./lib');
                    for (let i = 0; i < libFiles.length; i++) {
                        if (libFiles[i].endsWith('.ts') || libFiles[i].endsWith('.js')) {
                            if (!libFiles[i].includes('..') && !libFiles[i].includes('/') && !libFiles[i].includes('\\')) {
                                codeFiles.push({ 
                                    name: './lib/' + libFiles[i], 
                                    // nosemgrep: detect-non-literal-fs-filename
                                    content: fs.readFileSync('./lib/' + libFiles[i], 'utf8') 
                                });
                            }
                        }
                    }
                }
            } catch (e) { console.warn('Cannot scan ./lib:', e.message); }
            
            // Scan bin directory
            try {
                if (fs.existsSync('./bin')) {
                    const binFiles = fs.readdirSync('./bin');
                    for (let i = 0; i < binFiles.length; i++) {
                        if (binFiles[i].endsWith('.ts') || binFiles[i].endsWith('.js')) {
                            if (!binFiles[i].includes('..') && !binFiles[i].includes('/') && !binFiles[i].includes('\\')) {
                                codeFiles.push({ 
                                    name: './bin/' + binFiles[i], 
                                    // nosemgrep: detect-non-literal-fs-filename
                                    content: fs.readFileSync('./bin/' + binFiles[i], 'utf8') 
                                });
                            }
                        }
                    }
                }
            } catch (e) { console.warn('Cannot scan ./bin:', e.message); }
        };
        
        scanDirectories();

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
                    content: `You are a security expert performing a SAST analysis. Analyze the following code and provide two outputs: a markdown report and a JSON findings summary.

                    Analysis Parameters:
                    - Severity Threshold: ${severityThreshold}
                    - Max High Findings: ${maxHighFindings}
                    - Medium High Findings: ${maxMediumFindings}

                    Code to analyze:
                    ${codeFiles.map(file => `\nFile: ${file.name}\n\`\`\`typescript\n${file.content}\n\`\`\``).join('\n')}
                    
                    Provide your response in exactly this format:

                    <START_MARKDOWN>
                    # SAST Security Analysis Report
                    Generated: ${new Date().toISOString()}

                    ## Executive Summary
                    [Brief overview of findings]

                    ## Findings Summary
                    - Critical: [count]
                    - High: [count]
                    - Medium: [count]
                    - Low: [count]

                    ## Detailed Findings
                    [Detailed findings by severity]

                    ## Recommendations
                    [Specific remediation steps]

                    ## Best Practices
                    [Security best practices]
                    <END_MARKDOWN>

                    <START_JSON>
                    {
                      "findings": {
                        "critical": [],
                        "high": [],
                        "medium": [],
                        "low": []
                      },
                      "summary": {
                        "critical": 0,
                        "high": 0,
                        "medium": 0,
                        "low": 0
                      }
                    }
                    <END_JSON>`
                }]
            })
        };

        // Save request for debugging
        fs.writeFileSync('sast_request.json', stringify(bedrockRequest, { space: 2 }));

        // Call Bedrock
        const client = new BedrockRuntimeClient({ region: 'us-east-1' });
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

        // Parse JSON findings
        let findings;
        try {
            findings = JSON.parse(jsonMatch[1].trim());
        } catch (e) {
            throw new Error('Invalid JSON findings format in response');
        }

        // Save all outputs
        fs.writeFileSync('sast_report.md', markdownContent);
        fs.writeFileSync('sast_findings.json', stringify(findings, { space: 2 }));
        fs.writeFileSync('sast_report.json', stringify({
            ...findings,
            timestamp: new Date().toISOString()
        }, { space: 2 }));
        fs.writeFileSync('sast_analysis.json', stringify(responseBody, { space: 2 }));

        // Check thresholds
        if (findings.summary.critical > 0 || 
            findings.summary.high > maxHighFindings || 
            findings.summary.medium > maxMediumFindings) {
            throw new Error('SAST analysis failed: Threshold exceeded');
        }

        console.log('SAST analysis completed successfully');

    } catch (error) {
        console.error('Error in SAST analysis:', error);
        
        // Create error reports
        const errorReport = `# SAST Analysis Report\n\nError: ${error.message}\nTimestamp: ${new Date().toISOString()}`;
        fs.writeFileSync('sast_report.md', errorReport);
        
        const errorFindings = {
            findings: { critical: [], high: [], medium: [], low: [] },
            summary: { critical: 0, high: 0, medium: 0, low: 0 },
            error: error.message,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync('sast_findings.json', stringify(errorFindings, { space: 2 }));
        fs.writeFileSync('sast_report.json', stringify(errorFindings, { space: 2 }));
        
        process.exit(1);
    }
}

performSastAnalysis();
