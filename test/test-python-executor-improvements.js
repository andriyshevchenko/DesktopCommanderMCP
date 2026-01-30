import { executePythonCode } from '../dist/tools/python-executor.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

async function testPythonExecutorImprovements() {
  console.log("=== Testing Python Executor Improvements ===\n");

  let failedTests = 0;
  const totalTests = 4;

  // Test 1: Auto timeout detection with packages
  console.log("Test 1: Auto timeout detection (should default to 120s with packages)");
  try {
    // This test doesn't actually install packages, but checks that the timeout isn't failing immediately
    const result = await executePythonCode({
      code: "print('Testing auto timeout')",
      timeout_ms: "auto",
      install_packages: []  // Empty array to trigger auto timeout logic
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    if (!result.isError) {
      console.log("✓ Test 1 passed\n");
    } else {
      console.log("✗ Test 1 failed - Unexpected error\n");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 1 failed:", error);
    failedTests++;
  }

  // Test 2: Persistent workspace directory
  console.log("Test 2: Persistent workspace directory");
  const persistentWorkspace = path.join(os.homedir(), '.desktop-commander', 'python-workspace');
  try {
    const result1 = await executePythonCode({
      code: `
import os
with open('persistent_test.txt', 'w') as f:
    f.write('Test from first execution')
print(f'Created file in: {os.getcwd()}')
`,
      workspace: "persistent"
    });
    console.log("First execution result:", JSON.stringify(result1, null, 2));

    // Try to read the file in a second execution
    const result2 = await executePythonCode({
      code: `
import os
try:
    with open('persistent_test.txt', 'r') as f:
        content = f.read()
    print(f'Read from persistent file: {content}')
    print(f'Working directory: {os.getcwd()}')
except FileNotFoundError:
    print('ERROR: File not found - persistence failed!')
`,
      workspace: "persistent"
    });
    console.log("Second execution result:", JSON.stringify(result2, null, 2));

    if (result2.content && result2.content[0] && result2.content[0].text.includes('Test from first execution')) {
      console.log("✓ Test 2 passed - Persistent workspace works\n");
    } else {
      console.log("✗ Test 2 failed - Workspace persistence not working\n");
      failedTests++;
    }

    // Cleanup test file
    try {
      const testFile = path.join(persistentWorkspace, 'persistent_test.txt');
      await fs.unlink(testFile);
    } catch (cleanupError) {
      console.warn("Warning: Failed to cleanup test file:", cleanupError);
    }
  } catch (error) {
    console.error("✗ Test 2 failed:", error);
    failedTests++;
  }

  // Test 3: Custom workspace directory
  console.log("Test 3: Custom workspace directory");
  const customWorkspace = path.join(os.tmpdir(), `test-custom-workspace-${Date.now()}`);
  try {
    await fs.mkdir(customWorkspace, { recursive: true });

    const result = await executePythonCode({
      code: `
import os
with open('custom_test.txt', 'w') as f:
    f.write('Custom workspace test')
print(f'Working in: {os.getcwd()}')
`,
      workspace: customWorkspace
    });
    console.log("Result:", JSON.stringify(result, null, 2));

    // Verify file was created in custom workspace
    const fileExists = await fs.access(path.join(customWorkspace, 'custom_test.txt'))
      .then(() => true)
      .catch(() => false);

    if (fileExists) {
      console.log("✓ Test 3 passed - Custom workspace directory works\n");
    } else {
      console.log("✗ Test 3 failed - File not in custom workspace\n");
      failedTests++;
    }

    // Cleanup
    await fs.rm(customWorkspace, { recursive: true, force: true });
  } catch (error) {
    console.error("✗ Test 3 failed:", error);
    failedTests++;
  }

  // Test 4: Detailed return format
  console.log("Test 4: Detailed return format");
  try {
    const result = await executePythonCode({
      code: "print('Testing detailed format')",
      return_format: "detailed",
      workspace: "temp"
    });
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.content && result.content[0] && result.content[0].text.includes('Execution Details')) {
      console.log("✓ Test 4 passed - Detailed format includes execution info\n");
    } else {
      console.log("✗ Test 4 failed - Missing detailed information\n");
      failedTests++;
    }
  } catch (error) {
    console.error("✗ Test 4 failed:", error);
    failedTests++;
  }

  // Summary
  console.log("=== Test Summary ===");
  console.log(`Passed: ${totalTests - failedTests}/${totalTests}`);
  console.log(`Failed: ${failedTests}/${totalTests}`);
  
  if (failedTests > 0) {
    process.exit(1);
  }
}

testPythonExecutorImprovements().catch(error => {
  console.error("Test suite failed:", error);
  process.exit(1);
});
