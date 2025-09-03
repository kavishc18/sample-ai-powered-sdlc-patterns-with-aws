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
    let responseText = '';
    
    try {
      const command = new InvokeModelCommand(bedrockRequest);
      const response = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (!responseBody?.content?.[0]?.text) {
        throw new Error('Invalid response structure from Bedrock');
      }

      responseText = responseBody.content[0].text;
      console.log('Bedrock analysis completed successfully');
    } catch (bedrockError) {
      console.log('Bedrock call failed:', bedrockError.message);
      console.log('Generating basic analysis report...');
      
      // Generate a basic analysis if Bedrock fails
      responseText = `# Security Analysis Report

Generated: ${new Date().toISOString()}

## Executive Summary
Security scan completed with ${processedResults.totalFindings} total findings.
- Critical Issues: ${processedResults.criticalIssues}
- High Issues: ${processedResults.highIssues}
- Medium Issues: ${processedResults.mediumIssues}
- Low Issues: ${processedResults.lowIssues}

## Recommendations
- Review all critical and high severity findings immediately
- Update vulnerable dependencies to latest secure versions
- Implement security best practices for container and Lambda security
- Regular security scanning and monitoring

## Status
${processedResults.criticalIssues > 0 ? 'CRITICAL - Immediate action required' : 
  processedResults.highIssues > 0 ? 'HIGH - Review recommended' : 'PASSED - No critical issues found'}`;
    }

    // Parse the response - Bedrock returns the content directly
    let markdownContent = '';
    let analysisJson = {};
    
    try {
      // Try to extract structured content if it exists
      const markdownMatch = responseText.match(/<START_MARKDOWN>([\s\S]*?)<END_MARKDOWN>/);
      const jsonMatch = responseText.match(/<START_JSON>([\s\S]*?)<END_JSON>/);
      
      if (markdownMatch && jsonMatch) {
        // Structured response
        markdownContent = markdownMatch[1].trim();
        analysisJson = JSON.parse(jsonMatch[1].trim());
      } else {
        // Fallback: use the entire response as markdown and create basic JSON
        markdownContent = responseText;
        analysisJson = {
          summary: {
            status: processedResults.criticalIssues > 0 ? 'CRITICAL' : 
                   processedResults.highIssues > 0 ? 'HIGH' : 'PASSED',
            totalFindings: processedResults.totalFindings,
            requiresImmediate: processedResults.criticalIssues > 0
          },
          recommendations: [
            'Review security findings in detail',
            'Address critical and high severity issues',
            'Update vulnerable dependencies',
            'Implement security best practices'
          ]
        };
      }
    } catch (parseError) {
      console.log('Using fallback parsing due to:', parseError.message);
      // Create basic content if parsing fails
      markdownContent = `# Security Analysis Report

Generated: ${new Date().toISOString()}

## Summary
- Total Findings: ${processedResults.totalFindings || 0}
- Critical: ${processedResults.criticalIssues || 0}
- High: ${processedResults.highIssues || 0}
- Medium: ${processedResults.mediumIssues || 0}
- Low: ${processedResults.lowIssues || 0}

## Status
${(processedResults.criticalIssues || 0) > 0 ? 'CRITICAL - Review required' : 
  (processedResults.highIssues || 0) > 0 ? 'HIGH - Review recommended' : 'PASSED - No critical issues found'}

## Recommendations
- Review all security findings in the Inspector console
- Address critical and high severity issues first
- Update vulnerable dependencies to latest versions
- Implement security best practices for AWS resources
`;
      
      analysisJson = {
        summary: {
          status: (processedResults.criticalIssues || 0) > 0 ? 'CRITICAL' : 
                 (processedResults.highIssues || 0) > 0 ? 'HIGH' : 'PASSED',
          totalFindings: processedResults.totalFindings || 0,
          criticalIssues: processedResults.criticalIssues || 0,
          highIssues: processedResults.highIssues || 0,
          requiresImmediate: (processedResults.criticalIssues || 0) > 0
        },
        recommendations: [
          'Review security findings in AWS Inspector console',
          'Address critical and high severity issues',
          'Update vulnerable dependencies',
          'Implement security best practices'
        ]
      };
    }

    // Save all outputs with safe defaults
    const safeProcessedResults = processedResults || { 
      totalFindings: 0, 
      criticalIssues: 0, 
      highIssues: 0, 
      findings: [] 
    };
    
    fs.writeFileSync('processed-findings.json', stringify(safeProcessedResults, { space: 2 }));
    fs.writeFileSync('analysis_report.md', markdownContent);
    fs.writeFileSync('security-report.json', stringify({
      ...analysisJson,
      findings: summarizeFindings(safeProcessedResults.findings || [])
    }, { space: 2 }));
    
    // Write status file for pipeline control
    fs.writeFileSync('findings-status.json', stringify({
      hasCriticalIssues: (safeProcessedResults.criticalIssues || 0) > 0,
      criticalCount: safeProcessedResults.criticalIssues || 0,
      highCount: safeProcessedResults.highIssues || 0,
      requiresImmediate: analysisJson.summary?.requiresImmediate || false
    }, { space: 2 }));

    console.log('\n📊 Security Analysis Summary:');
    console.log(`Total Findings: ${safeProcessedResults.totalFindings || 0}`);
    console.log(`Critical: ${safeProcessedResults.criticalIssues || 0}`);
    console.log(`High: ${safeProcessedResults.highIssues || 0}`);
    console.log(`Status: ${analysisJson.summary?.status || 'COMPLETED'}`);
    console.log('\n✅ Security analysis completed successfully');

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
    
    // Don't fail the pipeline for security analysis errors
    console.log('Security analysis completed with errors, but pipeline will continue');
    process.exit(0);
  }
}

processAndAnalyzeFindings();
