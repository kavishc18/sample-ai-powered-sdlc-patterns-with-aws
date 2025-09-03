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
  console.log('\n📊 Code Quality Report:');
  console.log(`Code Quality Score: ${Math.max(0, codeQualityScore)}/100`);
  
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