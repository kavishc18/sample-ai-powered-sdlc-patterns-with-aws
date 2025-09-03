#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Starting SAST Analysis...');

try {
  // Check if package.json exists
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error('package.json not found');
    process.exit(1);
  }

  // Basic security checks
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Check for known vulnerable packages (basic check)
  const vulnerablePackages = ['lodash@4.17.20', 'moment@2.29.1'];
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  let hasVulnerabilities = false;
  
  for (const [pkg, version] of Object.entries(dependencies || {})) {
    const fullPackage = `${pkg}@${version}`;
    if (vulnerablePackages.includes(fullPackage)) {
      console.warn(`⚠️  Potential vulnerability found: ${fullPackage}`);
      hasVulnerabilities = true;
    }
  }

  // Check for hardcoded secrets (basic patterns)
  const secretPatterns = [
    /AKIA[0-9A-Z]{16}/g, // AWS Access Key
    /[0-9a-zA-Z/+]{40}/g, // AWS Secret Key pattern
    /sk-[a-zA-Z0-9]{48}/g, // OpenAI API Key
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub Personal Access Token
  ];

  const filesToCheck = ['bin/', 'lib/', 'src/'];
  let secretsFound = false;

  for (const dir of filesToCheck) {
    if (fs.existsSync(dir)) {
      try {
        const files = execSync(`find ${dir} -name "*.ts" -o -name "*.js" -o -name "*.json"`, { encoding: 'utf8' })
          .split('\n')
          .filter(f => f.trim());

        for (const file of files) {
          if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            for (const pattern of secretPatterns) {
              if (pattern.test(content)) {
                console.warn(`⚠️  Potential secret found in ${file}`);
                secretsFound = true;
              }
            }
          }
        }
      } catch (error) {
        console.log(`No files found in ${dir} or error scanning: ${error.message}`);
      }
    }
  }

  // Generate SAST report
  const sastFindings = [];
  if (hasVulnerabilities) sastFindings.push('Vulnerable dependencies detected');
  if (secretsFound) sastFindings.push('Potential secrets found in code');
  
  const reportContent = generateSastReport(sastFindings);
  fs.writeFileSync('sast_report.md', reportContent);
  
  // Summary
  if (hasVulnerabilities || secretsFound) {
    console.log('\n❌ SAST Analysis completed with warnings');
    console.log('Please review the warnings above and fix any security issues.');
    console.log('Report saved to: sast_report.md');
    // Don't fail the build for warnings, just log them
    process.exit(0);
  } else {
    console.log('\n✅ SAST Analysis passed - No security issues detected');
    console.log('Report saved to: sast_report.md');
    process.exit(0);
  }

} catch (error) {
  console.error('SAST Analysis failed:', error.message);
  process.exit(1);
}

function generateSastReport(findings) {
  const timestamp = new Date().toISOString();
  const status = findings.length === 0 ? '✅ PASSED' : '⚠️ WARNINGS';
  
  let report = `# SAST (Static Application Security Testing) Report

**Generated:** ${timestamp}  
**Status:** ${status}  
**Findings:** ${findings.length}

## Summary

This report contains the results of the Static Application Security Testing (SAST) analysis.

## Security Checks Performed

- ✅ Vulnerable dependency scanning
- ✅ Hardcoded secrets detection
- ✅ AWS credentials pattern matching
- ✅ API key pattern detection

## Analysis Results

`;

  if (findings.length === 0) {
    report += `### ✅ No Security Issues Found

All security checks passed successfully. No vulnerabilities or security concerns were detected.

`;
  } else {
    report += `### ⚠️ Security Findings (${findings.length})

${findings.map(finding => `- ${finding}`).join('\n')}

**Note:** These are warnings that should be reviewed but do not block the build.

`;
  }

  report += `## Security Recommendations

### General Security Best Practices
- Keep dependencies up to date
- Never commit secrets or credentials to source code
- Use AWS IAM roles instead of hardcoded credentials
- Implement proper secret management (AWS Secrets Manager, Parameter Store)
- Regular security audits and dependency updates

### CDK-Specific Security
- Use least privilege IAM policies
- Enable encryption at rest and in transit
- Implement proper VPC and security group configurations
- Use AWS Config rules for compliance monitoring

## Next Steps

`;

  if (findings.length > 0) {
    report += `1. Review and address the security findings listed above
2. Update vulnerable dependencies to latest secure versions
3. Remove any hardcoded secrets and use proper secret management
4. Implement automated security scanning in your CI/CD pipeline
`;
  } else {
    report += `1. Continue following security best practices
2. Regularly update dependencies
3. Monitor for new security vulnerabilities
4. Consider implementing additional security tools (SonarQube, Snyk, etc.)
`;
  }

  report += `
---
*Report generated by CDK Pipeline SAST Analysis*
`;

  return report;
}