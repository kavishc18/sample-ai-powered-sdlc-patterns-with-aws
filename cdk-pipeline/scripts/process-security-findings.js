const fs = require('fs');
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const stringify = require('json-stable-stringify');

async function processAndAnalyzeFindings() {
  try {
    // Read all security reports
    const inspectorFindings = JSON.parse(fs.readFileSync('inspector_findings.json', 'utf8'));
    let dependencyCheckReport = {};

    try {
      dependencyCheckReport = JSON.parse(fs.readFileSync('dependency-check-report.json', 'utf8'));
    } catch (e) { console.log('No Dependency-Check report found'); }

    const findings = inspectorFindings.findings || [];

    // Process and categorize findings
    const processedResults = {
      timestamp: new Date().toISOString(),
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      lowIssues: 0,
      findings: findings,
    };

    // Count issues by severity
    findings.forEach(finding => {
      switch(finding.severity) {
        case 'CRITICAL': processedResults.criticalIssues++; break;
        case 'HIGH': processedResults.highIssues++; break;
        case 'MEDIUM': processedResults.mediumIssues++; break;
        case 'LOW': processedResults.lowIssues++; break;
      }
    });

    // Summarize findings to reduce input size
    const summarizeFindings = (findings) => {
      return findings.map(finding => ({
        title: finding.title,
        severity: finding.severity,
        description: finding.description?.substring(0, 200) + '...',  // Truncate long descriptions
        resourceId: finding.resources?.[0]?.id || 'N/A',
        status: finding.status
      })).slice(0, 10);  // Limit to top 10 findings
    };

    // Summarize dependency check findings
    const summarizeDependencyCheck = (report) => {
      if (!report.dependencies) return [];
      return report.dependencies
        .filter(dep => dep.vulnerabilities)
        .slice(0, 10)
        .map(dep => ({
          name: dep.fileName,
          vulnerabilities: (dep.vulnerabilities || [])
            .slice(0, 3)
            .map(v => ({
              severity: v.severity,
              name: v.name
            }))
        }));
    };

    // Create summarized finding summary
    const findingSummary = summarizeFindings(findings);
    const dependencyCheckSummary = summarizeDependencyCheck(dependencyCheckReport);

    // Initialize Bedrock client
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });

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
          content: `As a security expert, analyze these security findings and provide a comprehensive security report.

Summary Statistics:
- Total Findings: ${findings.length}
- Critical Issues: ${processedResults.criticalIssues}
- High Issues: ${processedResults.highIssues}
- Medium Issues: ${processedResults.mediumIssues}
- Low Issues: ${processedResults.lowIssues}

Top AWS Inspector Findings:
${stringify(findingSummary, { space: 2 })}

Top Dependency Check Findings:
${stringify(dependencyCheckSummary, { space: 2 })}

Provide your analysis in exactly this format:

<START_MARKDOWN>
# Security Analysis Report
Generated: ${new Date().toISOString()}

## Executive Summary
[Provide brief overview of findings and severity]

## Critical and High Severity Issues
[List and analyze critical and high severity findings]

## Recommendations
[Provide specific recommendations]

## Risk Assessment
[Provide overall risk assessment]
<END_MARKDOWN>

<START_JSON>
{
  "summary": {
    "scanDate": "${new Date().toISOString()}",
    "totalIssues": ${findings.length},
    "criticalIssues": ${processedResults.criticalIssues},
    "highIssues": ${processedResults.highIssues},
    "mediumIssues": ${processedResults.mediumIssues},
    "lowIssues": ${processedResults.lowIssues},
    "riskLevel": "HIGH|MEDIUM|LOW",
    "requiresImmediate": true|false
  },
  "analysis": {
    "criticalFindings": [],
    "highFindings": [],
    "recommendations": []
  }
}
<END_JSON>`
        }]
      })
    };

    // Call Bedrock
    console.log('Calling Bedrock for comprehensive analysis...');
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
    const analysisJson = JSON.parse(jsonMatch[1].trim());

    // Save all outputs
    fs.writeFileSync('processed-findings.json', stringify(processedResults, { space: 2 }));
    fs.writeFileSync('analysis_report.md', markdownContent);
    fs.writeFileSync('security-report.json', stringify({
      ...analysisJson,
      findings: summarizeFindings(processedResults.findings)
    }, { space: 2 }));
    
    // Write status file for pipeline control
    fs.writeFileSync('findings-status.json', stringify({
      hasCriticalIssues: processedResults.criticalIssues > 0,
      criticalCount: processedResults.criticalIssues,
      highCount: processedResults.highIssues,
      requiresImmediate: analysisJson.summary.requiresImmediate
    }, { space: 2 }));

  } catch (error) {
    console.error('Error processing security findings:', error);
    
    // Create error reports
    const errorMarkdown = `# Security Analysis Error Report\n\nError: ${error.message}\nTimestamp: ${new Date().toISOString()}`;
    fs.writeFileSync('analysis_report.md', errorMarkdown);
    
    const errorJson = {
      error: 'Failed to process security findings',
      timestamp: new Date().toISOString(),
      errorMessage: error.message
    };
    fs.writeFileSync('security-report.json', stringify(errorJson, { space: 2 }));
    fs.writeFileSync('findings-status.json', stringify({
      hasCriticalIssues: false,
      criticalCount: 0,
      highCount: 0,
      error: error.message
    }, { space: 2 }));
    
    process.exit(1);
  }
}

processAndAnalyzeFindings();
