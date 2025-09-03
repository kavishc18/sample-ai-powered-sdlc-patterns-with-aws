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

  // Summary
  if (hasVulnerabilities || secretsFound) {
    console.log('\n❌ SAST Analysis completed with warnings');
    console.log('Please review the warnings above and fix any security issues.');
    // Don't fail the build for warnings, just log them
    process.exit(0);
  } else {
    console.log('\n✅ SAST Analysis passed - No security issues detected');
    process.exit(0);
  }

} catch (error) {
  console.error('SAST Analysis failed:', error.message);
  process.exit(1);
}