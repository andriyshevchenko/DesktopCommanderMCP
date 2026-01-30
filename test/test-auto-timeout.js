import { executePythonCode } from '../dist/tools/python-executor.js';

async function testAutoTimeout() {
  console.log("=== Testing Auto Timeout Feature ===\n");

  // Test 1: Default timeout (30s) when no packages
  console.log("Test 1: Default timeout without packages");
  const result1 = await executePythonCode({
    code: "print('No packages')"
  });
  console.log("Result:", JSON.stringify(result1, null, 2));

  // Test 2: Auto timeout with packages (should be 120s)
  console.log("\nTest 2: Auto timeout with packages specified");
  const result2 = await executePythonCode({
    code: "print('With packages')",
    install_packages: ["requests"] // dummy package
  });
  console.log("Note: If this test takes more than 30s but less than 120s, auto-timeout is working");
  console.log("Result:", JSON.stringify(result2, null, 2));

  // Test 3: Explicit timeout_ms overrides auto
  console.log("\nTest 3: Explicit timeout overrides auto");
  const result3 = await executePythonCode({
    code: "import time; time.sleep(0.5); print('Done')",
    timeout_ms: 5000,
    install_packages: ["requests"]
  });
  console.log("Result:", JSON.stringify(result3, null, 2));

  console.log("\n=== Auto Timeout Tests Complete ===");
}

testAutoTimeout().catch(error => {
  console.error("Test failed:", error);
  process.exit(1);
});
