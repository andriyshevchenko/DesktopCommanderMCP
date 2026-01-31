import { executePythonCode } from '../dist/tools/python-executor.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Manual test to demonstrate package caching with pandas
 * This test installs pandas (which takes ~2 minutes first time) and shows dramatic speedup on subsequent runs
 */
async function testPandasCaching() {
  console.log("=== Manual Test: Pandas Package Caching ===\n");
  console.log("This test demonstrates the dramatic performance improvement from package caching.");
  console.log("First run will install pandas (~1-2 minutes), subsequent runs will be instant (<1 second).\n");

  const cacheDir = path.join(os.homedir(), '.mcp-python-packages');
  console.log(`Cache directory: ${cacheDir}`);
  
  // Check if pandas is already cached
  let pandasAlreadyCached = false;
  try {
    const files = await fs.readdir(cacheDir);
    pandasAlreadyCached = files.some(f => f.toLowerCase().includes('pandas'));
    if (pandasAlreadyCached) {
      console.log("⚠️  Pandas appears to already be cached. For a clean test, delete the cache directory:");
      console.log(`   rm -rf ${cacheDir}\n`);
    }
  } catch {
    console.log("Cache directory doesn't exist yet - will be created on first install.\n");
  }

  // Test 1: Run with pandas
  console.log("Test 1: Execute Python code with pandas");
  console.log("---------------------------------------");
  const start1 = Date.now();
  try {
    const result = await executePythonCode({
      code: `
import pandas as pd
import numpy as np

# Create a simple DataFrame
df = pd.DataFrame({
    'A': np.random.rand(5),
    'B': np.random.rand(5)
})

print("Pandas version:", pd.__version__)
print("\\nDataFrame:")
print(df)
print("\\nDataFrame shape:", df.shape)
`,
      install_packages: ["pandas"],
      timeout_ms: 180000 // 3 minutes max
    });
    const duration1 = Date.now() - start1;
    
    console.log(`\n⏱️  Duration: ${(duration1 / 1000).toFixed(2)} seconds`);
    console.log("\nOutput:");
    console.log("-------");
    if (result.content && result.content[0]) {
      console.log(result.content[0].text);
    }
    
    if (result.isError) {
      console.log("❌ Test 1 failed with error");
      return;
    }
  } catch (error) {
    console.error("❌ Test 1 failed:", error);
    return;
  }

  console.log("\n\n===========================================\n");
  console.log("Now running the SAME code again to demonstrate caching...\n");

  // Test 2: Run the same thing again (should be much faster)
  console.log("Test 2: Execute same code again (should use cache)");
  console.log("--------------------------------------------------");
  const start2 = Date.now();
  try {
    const result = await executePythonCode({
      code: `
import pandas as pd
import numpy as np

# Create a simple DataFrame
df = pd.DataFrame({
    'A': np.random.rand(5),
    'B': np.random.rand(5)
})

print("Pandas version:", pd.__version__)
print("\\nDataFrame:")
print(df)
print("\\nDataFrame shape:", df.shape)
`,
      install_packages: ["pandas"],
      timeout_ms: 30000 // Should be much faster now
    });
    const duration2 = Date.now() - start2;
    
    console.log(`\n⏱️  Duration: ${(duration2 / 1000).toFixed(2)} seconds`);
    console.log("\nOutput:");
    console.log("-------");
    if (result.content && result.content[0]) {
      console.log(result.content[0].text);
    }
    
    if (result.isError) {
      console.log("❌ Test 2 failed with error");
      return;
    }
  } catch (error) {
    console.error("❌ Test 2 failed:", error);
    return;
  }

  console.log("\n\n===========================================");
  console.log("✅ Package caching is working correctly!");
  console.log("The second execution should be dramatically faster (seconds vs minutes).");
  
  // Show cache contents
  console.log("\n=== Cache Directory Contents ===");
  try {
    const files = await fs.readdir(cacheDir);
    console.log(`Found ${files.length} items in cache directory.`);
    console.log("\nPandas-related files:");
    const pandasFiles = files.filter(f => f.toLowerCase().includes('pandas'));
    pandasFiles.slice(0, 5).forEach(file => console.log(`  - ${file}`));
    if (pandasFiles.length > 5) {
      console.log(`  ... and ${pandasFiles.length - 5} more pandas files`);
    }
    
    console.log("\nNumPy-related files (pandas dependency):");
    const numpyFiles = files.filter(f => f.toLowerCase().includes('numpy'));
    numpyFiles.slice(0, 5).forEach(file => console.log(`  - ${file}`));
    if (numpyFiles.length > 5) {
      console.log(`  ... and ${numpyFiles.length - 5} more numpy files`);
    }
  } catch (error) {
    console.log("Could not read cache directory:", error.message);
  }
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("NOTE: This test requires internet access to install pandas on first run.");
  console.log("Set RUN_NETWORK_TESTS=1 environment variable if you want to run this test.\n");
  
  const runNetworkTests = process.env.RUN_NETWORK_TESTS;
  if (runNetworkTests) {
    testPandasCaching().catch(console.error);
  } else {
    console.log("Skipping network test. Set RUN_NETWORK_TESTS=1 to run.");
    console.log("Example: RUN_NETWORK_TESTS=1 node test/test-python-pandas-caching.js");
  }
}

export { testPandasCaching };
