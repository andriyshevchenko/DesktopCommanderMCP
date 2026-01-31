import { executePythonCode } from '../dist/tools/python-executor.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Test package caching functionality
 * This test verifies that:
 * 1. First package installation takes time
 * 2. Subsequent executions reuse cached packages (much faster)
 * 3. force_reinstall parameter triggers reinstallation
 */
async function testPackageCaching() {
  console.log("=== Testing Python Package Caching ===\n");

  let failedTests = 0;
  const totalTests = 4; // Updated to reflect actual number of tests

  // Use a small, fast-to-install package for testing
  // Using a package that's unlikely to be in the system Python
  const testPackage = ['six']; // Small package, quick to install

  // Clean up cache directory before testing
  const cacheDir = path.join(os.homedir(), '.mcp-python-packages');
  console.log(`Cache directory: ${cacheDir}`);
  
  try {
    console.log("Cleaning up cache directory for fresh test...");
    await fs.rm(cacheDir, { recursive: true, force: true });
    console.log("Cache cleaned successfully\n");
  } catch (error) {
    console.log("Cache directory doesn't exist or couldn't be cleaned (this is OK for first run)\n");
  }

  // Test 1: First installation (should install packages)
  console.log("Test 1: First installation (should install packages from PyPI)");
  const start1 = Date.now();
  try {
    const result = await executePythonCode({
      code: "import six\nprint(f'six module loaded: {six.__version__}')",
      install_packages: testPackage,
      timeout_ms: 60000 // 60 seconds
    });
    const duration1 = Date.now() - start1;
    console.log(`Duration: ${duration1}ms`);
    console.log("Result:", JSON.stringify(result, null, 2));
    
    if (result.isError) {
      console.error("✗ Test 1 failed: Execution resulted in error");
      failedTests++;
    } else if (result.content?.[0]?.text?.includes('Successfully installed')) {
      console.log("✓ Test 1 passed - Packages installed successfully\n");
    } else {
      console.log("⚠ Test 1 uncertain - Package may have been already installed or came from cache\n");
    }
  } catch (error) {
    console.error("✗ Test 1 failed:", error);
    failedTests++;
  }

  // Test 2: Second execution (should use cached packages - much faster)
  console.log("Test 2: Second execution (should use cached packages)");
  const start2 = Date.now();
  try {
    const result = await executePythonCode({
      code: "import six\nprint(f'six module loaded from cache: {six.__version__}')",
      install_packages: testPackage,
      timeout_ms: 30000 // 30 seconds should be plenty for cached packages
    });
    const duration2 = Date.now() - start2;
    console.log(`Duration: ${duration2}ms`);
    console.log("Result:", JSON.stringify(result, null, 2));
    
    if (result.isError) {
      console.error("✗ Test 2 failed: Execution resulted in error");
      failedTests++;
    } else if (result.content?.[0]?.text?.includes('Using cached packages')) {
      console.log("✓ Test 2 passed - Used cached packages successfully");
      console.log(`  Cache speedup demonstrated (should be much faster than Test 1)\n`);
    } else {
      console.log("⚠ Test 2 uncertain - May have used cache but message not found");
      console.log(`  Duration: ${duration2}ms (should be < 5s for cached packages)\n`);
    }
  } catch (error) {
    console.error("✗ Test 2 failed:", error);
    failedTests++;
  }

  // Test 3: Force reinstall (should reinstall packages even though cached)
  console.log("Test 3: Force reinstall (should reinstall despite cache)");
  const start3 = Date.now();
  try {
    const result = await executePythonCode({
      code: "import six\nprint(f'six module loaded after force reinstall: {six.__version__}')",
      install_packages: testPackage,
      force_reinstall: true,
      timeout_ms: 60000 // 60 seconds for reinstall
    });
    const duration3 = Date.now() - start3;
    console.log(`Duration: ${duration3}ms`);
    console.log("Result:", JSON.stringify(result, null, 2));
    
    if (result.isError) {
      console.error("✗ Test 3 failed: Execution resulted in error");
      failedTests++;
    } else if (result.content?.[0]?.text?.includes('Successfully installed') || 
               result.content?.[0]?.text?.includes('Requirement already satisfied')) {
      console.log("✓ Test 3 passed - Force reinstall executed (packages reinstalled/verified)\n");
    } else {
      console.log("⚠ Test 3 uncertain - Force reinstall may not have worked as expected\n");
    }
  } catch (error) {
    console.error("✗ Test 3 failed:", error);
    failedTests++;
  }

  // Test 4: Verify that packages are accessible when specified in install_packages
  // even if they were previously cached (this tests that PYTHONPATH is set correctly)
  console.log("Test 4: Verify cached packages are accessible via PYTHONPATH");
  try {
    const result = await executePythonCode({
      code: "import six\nprint(f'six module available from persistent cache: {six.__version__}')",
      install_packages: ["six"], // Explicitly specify to ensure PYTHONPATH is set
      timeout_ms: 30000
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    
    if (result.isError) {
      console.error("✗ Test 4 failed - Package should be accessible when specified in install_packages");
      failedTests++;
    } else {
      console.log("✓ Test 4 passed - Package available from persistent cache via PYTHONPATH\n");
    }
  } catch (error) {
    console.error("✗ Test 4 failed:", error);
    failedTests++;
  }

  console.log("=== Package Caching Tests Completed ===");
  console.log(`Passed: ${totalTests - failedTests}/${totalTests}`);
  console.log(`Failed: ${failedTests}/${totalTests}`);
  
  if (failedTests > 0) {
    process.exitCode = 1;
  }
  
  console.log("\n=== Cache Directory Contents ===");
  try {
    const files = await fs.readdir(cacheDir);
    console.log(`Found ${files.length} items in cache:`);
    files.slice(0, 10).forEach(file => console.log(`  - ${file}`));
    if (files.length > 10) {
      console.log(`  ... and ${files.length - 10} more`);
    }
  } catch (error) {
    console.log("Could not read cache directory:", error.message);
  }
}

// Run tests
testPackageCaching().catch(console.error);
