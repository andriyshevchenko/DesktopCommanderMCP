#!/usr/bin/env node
/**
 * E2E Test: Execute Python Code Tool with Real MCP Instance
 * Tests the execute_python_code tool through actual MCP client/server communication
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Test utilities
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName) {
  console.log(`\n${colors.bold}${colors.cyan}Test: ${testName}${colors.reset}`);
}

function logPass(message) {
  log(`   ✅ PASS: ${message}`, 'green');
}

function logFail(message) {
  log(`   ❌ FAIL: ${message}`, 'red');
}

function logInfo(message) {
  log(`   ℹ️  ${message}`, 'blue');
}

/**
 * Create MCP client and connect to server
 */
async function createMcpClient() {
  const client = new Client(
    {
      name: "e2e-test-client",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  const transport = new StdioClientTransport({
    command: "node",
    args: ["../dist/index.js"]
  });

  await client.connect(transport);
  return client;
}

/**
 * Test 1: Verify execute_python_code tool is available
 */
async function testToolAvailability(client) {
  logTest('Tool Availability');
  
  const tools = await client.listTools();
  const pythonTool = tools.tools.find(t => t.name === 'execute_python_code');
  
  if (pythonTool) {
    logPass('execute_python_code tool is registered');
    logInfo(`Description: ${pythonTool.description.substring(0, 100)}...`);
    return true;
  } else {
    logFail('execute_python_code tool not found');
    logInfo(`Available tools: ${tools.tools.map(t => t.name).join(', ')}`);
    return false;
  }
}

/**
 * Test 2: Simple Python code execution
 */
async function testSimpleExecution(client) {
  logTest('Simple Python Code Execution');
  
  try {
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: 'print("Hello from MCP Python executor!")\nprint(2 + 2)',
        timeout_ms: 10000
      }
    });
    
    if (result.isError) {
      logFail(`Execution returned error: ${JSON.stringify(result)}`);
      return false;
    }
    
    const output = result.content[0].text;
    logInfo(`Output: ${output}`);
    
    if (output.includes('Hello from MCP Python executor!') && output.includes('4')) {
      logPass('Simple execution successful');
      return true;
    } else {
      logFail('Output does not contain expected values');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: File operations in target directory
 */
async function testFileOperations(client) {
  logTest('File Operations in Target Directory');
  
  const testDir = path.join(os.tmpdir(), `e2e-python-test-${Date.now()}`);
  
  try {
    await fs.mkdir(testDir, { recursive: true });
    logInfo(`Test directory: ${testDir}`);
    
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: `
# Write test file
with open('test_output.txt', 'w') as f:
    f.write('Test data from Python')

# Read it back
with open('test_output.txt', 'r') as f:
    content = f.read()
    print(f'File content: {content}')
`,
        target_directory: testDir,
        timeout_ms: 15000
      }
    });
    
    if (result.isError) {
      logFail(`Execution returned error: ${JSON.stringify(result)}`);
      return false;
    }
    
    const output = result.content[0].text;
    logInfo(`Output: ${output}`);
    
    // Verify file was created
    const filePath = path.join(testDir, 'test_output.txt');
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    
    if (fileExists && output.includes('Test data from Python')) {
      const fileContent = await fs.readFile(filePath, 'utf8');
      logInfo(`File created with content: ${fileContent}`);
      logPass('File operations successful');
      return true;
    } else {
      logFail('File was not created or content is incorrect');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    return false;
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Test 4: Filesystem restrictions
 */
async function testFilesystemRestrictions(client) {
  logTest('Filesystem Access Restrictions');
  
  const testDir = path.join(os.tmpdir(), `e2e-python-restricted-${Date.now()}`);
  
  try {
    await fs.mkdir(testDir, { recursive: true });
    
    const unauthorizedPath = os.platform() === 'win32' 
      ? 'C:\\Windows\\unauthorized.txt' 
      : '/etc/unauthorized.txt';
    
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: `
import sys
try:
    with open('${unauthorizedPath}', 'w') as f:
        f.write('Should not work')
    print('ERROR: Access was allowed!', file=sys.stderr)
except PermissionError as e:
    print(f'Access correctly blocked: {e}')
`,
        target_directory: testDir,
        timeout_ms: 10000
      }
    });
    
    if (result.isError) {
      logFail(`Unexpected error: ${JSON.stringify(result)}`);
      return false;
    }
    
    const output = result.content[0].text;
    logInfo(`Output: ${output}`);
    
    if (output.includes('Access correctly blocked') || output.includes('PermissionError')) {
      logPass('Filesystem restrictions working correctly');
      return true;
    } else {
      logFail('Filesystem restrictions not enforced');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    return false;
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Test 5: Package installation
 */
async function testPackageInstallation(client) {
  logTest('Automatic Package Installation');
  
  try {
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: `
try:
    import requests
    print(f'requests version: {requests.__version__}')
    print('Package import successful!')
except ImportError as e:
    print(f'Failed to import: {e}')
`,
        install_packages: ['requests'],
        timeout_ms: 90000  // Longer timeout for package installation
      }
    });
    
    if (result.isError) {
      logFail(`Execution returned error: ${JSON.stringify(result)}`);
      logInfo('Note: This may fail if pip is not available or internet is not accessible');
      return false;
    }
    
    const output = result.content[0].text;
    logInfo(`Output: ${output}`);
    
    if (output.includes('Package import successful!') && output.includes('requests version:')) {
      logPass('Package installation and import successful');
      return true;
    } else {
      logFail('Package installation or import failed');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    logInfo('Note: This may fail if pip is not available or internet is not accessible');
    return false;
  }
}

/**
 * Test 6: Error handling
 */
async function testErrorHandling(client) {
  logTest('Error Handling');
  
  try {
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: `
print('Before error')
raise ValueError('Test error message')
print('Should not reach here')
`,
        timeout_ms: 10000
      }
    });
    
    const output = result.content[0].text;
    logInfo(`Output: ${output}`);
    
    if (result.isError && 
        output.includes('ValueError') && 
        output.includes('Test error message') &&
        output.includes('Before error')) {
      logPass('Error handling working correctly');
      return true;
    } else {
      logFail('Error not properly caught and reported');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    return false;
  }
}

/**
 * Test 7: Timeout handling
 */
async function testTimeoutHandling(client) {
  logTest('Timeout Handling');
  
  try {
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: `
import time
print('Starting long operation...')
time.sleep(10)
print('Should not reach here')
`,
        timeout_ms: 2000
      }
    });
    
    const output = result.content[0].text;
    logInfo(`Output: ${output}`);
    
    if (result.isError && output.includes('timed out')) {
      logPass('Timeout handling working correctly');
      return true;
    } else {
      logFail('Timeout not properly enforced');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    return false;
  }
}

/**
 * Test 8: Real-world data analysis scenario
 */
async function testRealWorldScenario(client) {
  logTest('Real-World Data Analysis (pandas)');
  
  const testDir = path.join(os.tmpdir(), `e2e-python-analysis-${Date.now()}`);
  
  try {
    await fs.mkdir(testDir, { recursive: true });
    
    // Create sample CSV
    const csvData = 'name,sales,region\nAlice,1000,North\nBob,1500,South\nCharlie,800,North\nAlice,500,South';
    await fs.writeFile(path.join(testDir, 'sales.csv'), csvData, 'utf8');
    logInfo('Created sample CSV file');
    
    const result = await client.callTool({
      name: 'execute_python_code',
      arguments: {
        code: `
import pandas as pd

# Load data
df = pd.read_csv('sales.csv')
print('Dataset loaded:')
print(df)
print()

# Calculate totals by person
totals = df.groupby('name')['sales'].sum().sort_values(ascending=False)
print('Total sales by person:')
print(totals)
print()

# Calculate totals by region
region_totals = df.groupby('region')['sales'].sum()
print('Total sales by region:')
print(region_totals)
`,
        target_directory: testDir,
        install_packages: ['pandas'],
        timeout_ms: 90000
      }
    });
    
    if (result.isError) {
      logFail(`Execution returned error: ${JSON.stringify(result)}`);
      logInfo('Note: This may fail if pip is not available or internet is not accessible');
      return false;
    }
    
    const output = result.content[0].text;
    logInfo(`Output:\n${output}`);
    
    if (output.includes('Bob') && output.includes('1500') && 
        output.includes('North') && output.includes('South')) {
      logPass('Real-world data analysis successful');
      return true;
    } else {
      logFail('Expected data analysis output not found');
      return false;
    }
  } catch (error) {
    logFail(`Exception: ${error.message}`);
    logInfo('Note: This may fail if pip is not available or internet is not accessible');
    return false;
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Main test runner
 */
async function runE2ETests() {
  console.log('\n' + '='.repeat(60));
  log('E2E Tests: execute_python_code Tool with Real MCP Instance', 'bold');
  console.log('='.repeat(60));
  
  let client;
  let passCount = 0;
  let totalTests = 0;
  
  try {
    log('\nConnecting to MCP server...', 'blue');
    client = await createMcpClient();
    log('✓ Connected successfully', 'green');
    
    const tests = [
      { name: 'Tool Availability', fn: testToolAvailability },
      { name: 'Simple Execution', fn: testSimpleExecution },
      { name: 'File Operations', fn: testFileOperations },
      { name: 'Filesystem Restrictions', fn: testFilesystemRestrictions },
      { name: 'Package Installation', fn: testPackageInstallation },
      { name: 'Error Handling', fn: testErrorHandling },
      { name: 'Timeout Handling', fn: testTimeoutHandling },
      { name: 'Real-World Scenario', fn: testRealWorldScenario },
    ];
    
    for (const test of tests) {
      totalTests++;
      const passed = await test.fn(client);
      if (passed) passCount++;
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } catch (error) {
    log(`\nFatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      log('\n✓ Disconnected from MCP server', 'green');
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  log('Test Summary', 'bold');
  console.log('='.repeat(60));
  log(`Total tests: ${totalTests}`, 'blue');
  log(`Passed: ${passCount}`, 'green');
  log(`Failed: ${totalTests - passCount}`, 'red');
  
  if (passCount === totalTests) {
    console.log('\n' + colors.green + colors.bold + '🎉 All E2E tests passed!' + colors.reset + '\n');
    process.exit(0);
  } else {
    console.log('\n' + colors.red + colors.bold + '❌ Some E2E tests failed' + colors.reset + '\n');
    process.exit(1);
  }
}

// Run tests
runE2ETests().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
