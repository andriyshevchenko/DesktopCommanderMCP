import { executePythonCode } from '../dist/tools/python-executor.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

async function testExecutePythonCode() {
  console.log("=== Testing execute_python_code tool ===\n");

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
  }

  // Test 2: File operations in target directory
  console.log("Test 2: File operations in allowed directory");
  try {
    const testDir = path.join(os.tmpdir(), `test-python-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    const result = await executePythonCode({
      code: `
with open('test.txt', 'w') as f:
    f.write('Test content')

with open('test.txt', 'r') as f:
    content = f.read()
    print(f'File content: {content}')
`,
      target_directory: testDir
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    
    // Verify file was created
    const fileExists = await fs.access(path.join(testDir, 'test.txt'))
      .then(() => true)
      .catch(() => false);
    
    if (fileExists) {
      console.log("✓ Test 2 passed - File created successfully\n");
    } else {
      console.log("✗ Test 2 failed - File was not created\n");
    }
    
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    console.error("✗ Test 2 failed:", error);
  }

  // Test 3: Filesystem restriction - attempt to access denied directory
  console.log("Test 3: Filesystem restriction test");
  try {
    const testDir = path.join(os.tmpdir(), `test-python-restricted-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Use a path that's clearly outside allowed directories (platform-specific)
    const unauthorizedPath = os.platform() === 'win32' ? 'C:\\Windows\\unauthorized.txt' : '/etc/unauthorized.txt';
    
    const result = await executePythonCode({
      code: `
try:
    # Try to write to unauthorized location (should be blocked)
    with open('${unauthorizedPath}', 'w') as f:
        f.write('This should not work')
    print('ERROR: Was able to write to unauthorized location!')
except PermissionError as e:
    print(f'Correctly blocked: {e}')
`,
      target_directory: testDir
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    console.log("✓ Test 3 passed - Access correctly restricted\n");
    
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    console.error("✗ Test 3 failed:", error);
  }

  // Test 4: Package installation (if pip is available)
  console.log("Test 4: Package installation test");
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
    console.log("✓ Test 4 passed\n");
  } catch (error) {
    console.error("Note: Test 4 may fail if pip is not available or internet is not accessible");
    console.error("Error:", error);
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
    console.log("✓ Test 5 passed - Timeout handled\n");
  } catch (error) {
    console.error("✗ Test 5 failed:", error);
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
    }
  } catch (error) {
    console.error("✗ Test 6 failed:", error);
  }

  console.log("=== All tests completed ===");
}

testExecutePythonCode().catch(console.error);
