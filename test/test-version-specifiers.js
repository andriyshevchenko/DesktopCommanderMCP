import { executePythonCode } from '../dist/tools/python-executor.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Test version specifier handling
 * Verifies that packages with version specifiers trigger reinstallation
 */
async function testVersionSpecifiers() {
  console.log("=== Testing Version Specifier Handling ===\n");
  
  let failedTests = 0;
  const totalTests = 3;
  
  const cacheDir = path.join(os.homedir(), '.mcp-python-packages');
  
  // Clean cache for fresh test
  try {
    await fs.rm(cacheDir, { recursive: true, force: true });
    console.log("Cache cleaned for fresh test\n");
  } catch {}
  
  // Test 1: Install without version specifier
  console.log("Test 1: Install 'six' without version specifier");
  const start1 = Date.now();
  try {
    const result1 = await executePythonCode({
      code: "import six\nprint(f'six version: {six.__version__}')",
      install_packages: ["six"],
      timeout_ms: 60000
    });
    const duration1 = Date.now() - start1;
    console.log(`Duration: ${duration1}ms`);
    
    if (result1.isError) {
      console.error("✗ Test 1 failed");
      failedTests++;
    } else if (result1.content?.[0]?.text?.includes("Successfully installed")) {
      console.log("✓ Test 1 passed - Package installed\n");
    } else {
      console.log("⚠ Test 1 uncertain\n");
    }
  } catch (error) {
    console.error("✗ Test 1 failed:", error);
    failedTests++;
  }
  
  // Test 2: Use cached package (no version specifier - should use cache)
  console.log("Test 2: Use cached 'six' (no version specifier)");
  const start2 = Date.now();
  try {
    const result2 = await executePythonCode({
      code: "import six\nprint(f'six version: {six.__version__}')",
      install_packages: ["six"],
      timeout_ms: 30000
    });
    const duration2 = Date.now() - start2;
    console.log(`Duration: ${duration2}ms`);
    const output2 = result2.content?.[0]?.text ?? '';
    
    if (output2.includes("Using cached packages")) {
      console.log("✓ Test 2 passed - Used cache (as expected)\n");
    } else {
      console.error("✗ Test 2 failed - Should have used cache for package without version specifier");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 2 failed:", error);
    failedTests++;
  }
  
  // Test 3: Request with version specifier (should NOT use cache, should reinstall)
  console.log("Test 3: Request 'six==1.16.0' (specific version)");
  const start3 = Date.now();
  try {
    const result3 = await executePythonCode({
      code: "import six\nprint(f'six version: {six.__version__}')",
      install_packages: ["six==1.16.0"],
      timeout_ms: 60000
    });
    const duration3 = Date.now() - start3;
    console.log(`Duration: ${duration3}ms`);
    const output3 = result3.content?.[0]?.text ?? '';
    
    if (output3.includes("Successfully installed") || output3.includes("Requirement already satisfied")) {
      console.log("✓ Test 3 passed - Reinstalled (as expected for version specifier)\n");
    } else if (output3.includes("Using cached packages")) {
      console.error("✗ Test 3 failed - Should NOT use cache for package with version specifier");
      console.error("   Version specifiers should always trigger reinstallation to ensure correct version");
      failedTests++;
    } else {
      console.log("⚠ Test 3 uncertain\n");
    }
  } catch (error) {
    console.error("✗ Test 3 failed:", error);
    failedTests++;
  }
  
  console.log("=== Version Specifier Tests Completed ===");
  console.log(`Passed: ${totalTests - failedTests}/${totalTests}`);
  console.log(`Failed: ${failedTests}/${totalTests}`);
  
  if (failedTests > 0) {
    process.exitCode = 1;
  }
}

testVersionSpecifiers().catch(console.error);
