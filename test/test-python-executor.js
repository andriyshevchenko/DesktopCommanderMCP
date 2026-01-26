import { executePythonCode } from '../dist/tools/python-executor.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

async function testExecutePythonCode() {
  console.log("=== Testing execute_python_code tool ===\n");

  let failedTests = 0;
  
  // Check if network tests should be run - accept common truthy values
  const networkTestsEnv = (process.env.RUN_NETWORK_TESTS || '').toLowerCase();
  const runNetworkTests = ['1', 'true', 'yes', 'on'].includes(networkTestsEnv);
  const totalTests = runNetworkTests ? 6 : 5;

  // Test 1: Simple code execution
  console.log("Test 1: Simple Python code execution");
  try {
    const result = await executePythonCode({
      code: "print('Hello from sandboxed Python!')\nprint(2 + 2)"
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    console.log("✓ Test 1 passed\n");
  } catch (error) {
    console.error("✗ Test 1 failed:", error);
    failedTests++;
  }

  // Test 2: File operations in target directory
  console.log("Test 2: File operations in allowed directory");
  const testDir2 = path.join(os.tmpdir(), `test-python-${Date.now()}`);
  try {
    await fs.mkdir(testDir2, { recursive: true });
    
    const result = await executePythonCode({
      code: `
with open('test.txt', 'w') as f:
    f.write('Test content')

with open('test.txt', 'r') as f:
    content = f.read()
    print(f'File content: {content}')
`,
      target_directory: testDir2
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    
    // Verify file was created
    const fileExists = await fs.access(path.join(testDir2, 'test.txt'))
      .then(() => true)
      .catch(() => false);
    
    if (fileExists) {
      console.log("✓ Test 2 passed - File created successfully\n");
    } else {
      console.log("✗ Test 2 failed - File was not created\n");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 2 failed:", error);
    failedTests++;
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir2, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - temp directory may already be removed
    }
  }

  // Test 3: Filesystem restriction - attempt to access denied directory
  console.log("Test 3: Filesystem restriction test");
  const testDir3 = path.join(os.tmpdir(), `test-python-restricted-${Date.now()}`);
  const unauthorizedDir3 = path.join(os.tmpdir(), `test-python-unauthorized-${Date.now()}`);
  try {
    await fs.mkdir(testDir3, { recursive: true });
    
    // Create a separate unauthorized directory that's writable but outside allowed directories
    await fs.mkdir(unauthorizedDir3, { recursive: true });
    const unauthorizedPath = path.join(unauthorizedDir3, 'unauthorized.txt');
    // Escape backslashes for Windows paths in Python string literals
    const escapedUnauthorizedPath = unauthorizedPath.replace(/\\/g, '\\\\');
    
    const result = await executePythonCode({
      code: `
try:
    # Try to write to unauthorized location (should be blocked)
    with open('${escapedUnauthorizedPath}', 'w') as f:
        f.write('This should not work')
    print('ERROR: Was able to write to unauthorized location!')
except PermissionError as e:
    print(f'Correctly blocked: {e}')
`,
      target_directory: testDir3
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    
    // Validate the result
    if (result.content && result.content[0] && result.content[0].text) {
      const output = result.content[0].text;
      if (output.includes('Correctly blocked') || output.includes('PermissionError')) {
        // Also verify the file was NOT created in the unauthorized directory
        try {
          await fs.access(unauthorizedPath3);
          console.log("✗ Test 3 failed - File was created in unauthorized directory despite error\n");
          failedTests++;
        } catch {
          // File doesn't exist - this is correct
          console.log("✓ Test 3 passed - Access correctly restricted and file not created\n");
        }
      } else {
        console.log("✗ Test 3 failed - Unauthorized access was not blocked\n");
        failedTests++;
      }
    } else {
      console.log("✗ Test 3 failed - Unexpected result structure\n");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 3 failed:", error);
    failedTests++;
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir3, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - temp directory may already be removed
    }
    try {
      await fs.rm(unauthorizedDir3, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - temp directory may already be removed
    }
  }

  // Test 4: Package installation (if pip is available)
  console.log("Test 4: Package installation test");
  
  if (!runNetworkTests) {
    console.log("⊘ Test 4 skipped - Set RUN_NETWORK_TESTS=1 to enable network-dependent tests\n");
  } else {
    try {
      const result = await executePythonCode({
        code: `
try:
    import requests
    print(f'requests module version: {requests.__version__}')
    print('Package installation successful!')
except ImportError as e:
    print(f'Failed to import: {e}')
`,
        install_packages: ['requests']
      });
      console.log("Result:", JSON.stringify(result, null, 2));
      
      // Validate the result
      if (result.content && result.content[0] && result.content[0].text) {
        const output = result.content[0].text;
        if (!result.isError && output.includes('Package installation successful!')) {
          console.log("✓ Test 4 passed - Package installation successful\n");
        } else {
          console.log("✗ Test 4 failed - Package not properly installed or imported\n");
          failedTests++;
        }
      } else {
        console.log("✗ Test 4 failed - Unexpected result structure\n");
        failedTests++;
      }
    } catch (error) {
      console.error("✗ Test 4 failed:", error);
      failedTests++;
    }
  }

  // Test 5: Timeout test
  console.log("Test 5: Timeout handling");
  try {
    const result = await executePythonCode({
      code: `
import time
print('Starting long operation...')
time.sleep(10)
print('Should not reach here')
`,
      timeout_ms: 2000
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    
    // Validate the result
    if (result.content && result.content[0] && result.content[0].text) {
      if (result.isError && result.content[0].text.includes('timed out')) {
        console.log("✓ Test 5 passed - Timeout properly enforced\n");
      } else {
        console.log("✗ Test 5 failed - Timeout not properly handled\n");
        failedTests++;
      }
    } else {
      console.log("✗ Test 5 failed - Unexpected result structure\n");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 5 failed:", error);
    failedTests++;
  }

  // Test 6: Error handling
  console.log("Test 6: Error handling in user code");
  try {
    const result = await executePythonCode({
      code: `
print('Before error')
raise ValueError('Test error')
print('After error - should not print')
`
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    if (result.isError) {
      console.log("✓ Test 6 passed - Error properly caught and reported\n");
    } else {
      console.log("✗ Test 6 failed - Error not properly detected\n");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 6 failed:", error);
    failedTests++;
  }

  console.log("=== All tests completed ===");
  console.log(`Passed: ${totalTests - failedTests}/${totalTests}`);
  console.log(`Failed: ${failedTests}/${totalTests}`);
  
  if (failedTests > 0) {
    process.exitCode = 1;
  }
}

testExecutePythonCode().catch(console.error);
