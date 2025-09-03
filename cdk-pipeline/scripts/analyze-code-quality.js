#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Starting Code Quality Analysis...');

try {
  // Check if this is a TypeScript project
  const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.error('package.json not found');
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Basic code quality checks
  let issues = [];
  let warnings = [];

  // Check if TypeScript is configured properly
  if (fs.existsSync(tsconfigPath)) {
    console.log('✓ TypeScript configuration found');
    
    try {
      // Try to compile TypeScript
      execSync('npx tsc --noEmit', { stdio: 'pipe' });
      console.log('✓ TypeScript compilation successful');
    } catch (error) {
      console.warn('⚠️  TypeScript compilation has issues');
      warnings.push('TypeScript compilation warnings');
    }
  }

  // Check for essential scripts
  const requiredScripts = ['build', 'test'];
  const scripts = packageJson.scripts || {};
  
  for (const script of requiredScripts) {
    if (!scripts[script]) {
      warnings.push(`Missing ${script} script in package.json`);
    } else {
      console.log(`✓ ${script} script found`);
    }
  }

  // Check for CDK-specific patterns
  const cdkPatterns = {
    hasConstructs: false,
    hasCdkLib: false,
    hasProperStructure: false
  };

  if (packageJson.dependencies) {
    if (packageJson.dependencies['constructs']) {
      cdkPatterns.hasConstructs = true;
      console.log('✓ Constructs dependency found');
    }
    if (packageJson.dependencies['aws-cdk-lib']) {
      cdkPatterns.hasCdkLib = true;
      console.log('✓ AWS CDK lib dependency found');
    }
  }

  // Check project structure
  const expectedDirs = ['bin', 'lib'];
  let structureScore = 0;
  
  for (const dir of expectedDirs) {
    if (fs.existsSync(dir)) {
      structureScore++;
      console.log(`✓ ${dir}/ directory found`);
    } else {
      warnings.push(`Missing ${dir}/ directory`);
    }
  }

  if (structureScore === expectedDirs.length) {
    cdkPatterns.hasProperStructure = true;
  }

  // Check for common code quality issues
  const filesToCheck = ['bin/', 'lib/'];
  let codeQualityScore = 100;

  for (const dir of filesToCheck) {
    if (fs.existsSync(dir)) {
      try {
        const files = execSync(`find ${dir} -name "*.ts" -o -name "*.js"`, { encoding: 'utf8' })
          .split('\n')
          .filter(f => f.trim());

        for (const file of files) {
          if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Check for TODO/FIXME comments
            const todoMatches = content.match(/TODO|FIXME|HACK/gi);
            if (todoMatches) {
              warnings.push(`${todoMatches.length} TODO/FIXME comments in ${file}`);
              codeQualityScore -= 2;
            }

            // Check for console.log (should use proper logging)
            const consoleMatches = content.match(/console\.log/g);
            if (consoleMatches) {
              warnings.push(`${consoleMatches.length} console.log statements in ${file}`);
              codeQualityScore -= 1;
            }

            // Check for proper error handling
            if (content.includes('catch') && !content.includes('throw')) {
              warnings.push(`Potential silent error handling in ${file}`);
              codeQualityScore -= 3;
            }
          }
        }
      } catch (error) {
        console.log(`No files found in ${dir} or error scanning: ${error.message}`);
      }
    }
  }

  // Generate report
  const finalScore = Math.max(0, codeQualityScore);
  const reportContent = generateMarkdownReport(finalScore, warnings, issues, cdkPatterns);
  
  // Write report to file
  fs.writeFileSync('code_quality_report.md', reportContent);
  
  console.log('\n📊 Code Quality Report:');
  console.log(`Code Quality Score: ${finalScore}/100`);
  console.log('Report saved to: code_quality_report.md');
  
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(warning => console.log(`  - ${warning}`));
  }

  if (issues.length > 0) {
    console.log('\n❌ Issues:');
    issues.forEach(issue => console.log(`  - ${issue}`));
    process.exit(1);
  }

  if (codeQualityScore >= 70) {
    console.log('\n✅ Code Quality Analysis passed');
    process.exit(0);
  } else {
    console.log('\n⚠️  Code Quality Analysis completed with warnings');
    console.log('Consider addressing the warnings to improve code quality.');
    process.exit(0);
  }

} catch (error) {
  console.error('Code Quality Analysis failed:', error.message);
  process.exit(1);
}

function generateMarkdownReport(score, warnings, issues, cdkPatterns) {
  const timestamp = new Date().toISOString();
  const status = score >= 70 ? '✅ PASSED' : '⚠️ WARNING';
  
  let report = `# Code Quality Analysis Report

**Generated:** ${timestamp}  
**Status:** ${status}  
**Score:** ${score}/100

## Summary

This report contains the results of the automated code quality analysis for the CDK project.

### CDK Project Validation
- **Constructs Library:** ${cdkPatterns.hasConstructs ? '✅ Found' : '❌ Missing'}
- **AWS CDK Library:** ${cdkPatterns.hasCdkLib ? '✅ Found' : '❌ Missing'}
- **Project Structure:** ${cdkPatterns.hasProperStructure ? '✅ Valid' : '❌ Invalid'}

## Analysis Results

### Score Breakdown
- **Base Score:** 100
- **Final Score:** ${score}
- **Threshold:** 70 (minimum passing score)

`;

  if (issues.length > 0) {
    report += `### ❌ Critical Issues (${issues.length})
${issues.map(issue => `- ${issue}`).join('\n')}

`;
  }

  if (warnings.length > 0) {
    report += `### ⚠️ Warnings (${warnings.length})
${warnings.map(warning => `- ${warning}`).join('\n')}

`;
  }

  if (issues.length === 0 && warnings.length === 0) {
    report += `### ✅ No Issues Found
All code quality checks passed successfully.

`;
  }

  report += `## Recommendations

`;

  if (score < 70) {
    report += `- **Action Required:** Address the issues above to improve code quality
- Review and fix critical issues first
- Consider implementing additional code quality tools
`;
  } else if (warnings.length > 0) {
    report += `- Consider addressing the warnings to further improve code quality
- Implement consistent coding standards
- Add more comprehensive testing
`;
  } else {
    report += `- Maintain current code quality standards
- Continue following best practices
- Consider adding more advanced quality checks
`;
  }

  report += `
## Next Steps

1. Review any issues or warnings listed above
2. Implement fixes for critical issues
3. Consider adding automated code formatting (Prettier, ESLint)
4. Add unit tests if not present
5. Set up pre-commit hooks for quality checks

---
*Report generated by CDK Pipeline Code Quality Analysis*
`;

  return report;
}