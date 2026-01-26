# E2E Tests with Real LLM

This directory contains end-to-end tests that use a real Language Model (OpenAI) to interact with the MCP tools.

## Test Files

### `test-python-executor-e2e.js`
Standard E2E tests that verify the MCP Client/Server protocol without requiring an LLM. These tests:
- Connect to the MCP server via StdioClientTransport
- Call tools directly through the MCP protocol
- Verify tool registration, execution, sandboxing, and error handling

**Run with:**
```bash
node test/test-python-executor-e2e.js
```

### `test-python-executor-llm-e2e.js`
Advanced E2E tests that use a real LLM (OpenAI GPT-4) to test the tools. These tests:
- Connect to both the MCP server and OpenAI API
- Present the MCP tools to the LLM as available functions
- Let the LLM decide when and how to use the tools
- Verify the LLM can successfully execute Python code through the tool

**Requirements:**
- OpenAI API key set in `OPENAI_API_KEY` environment variable
- Internet connection for OpenAI API access

**Run with:**
```bash
export OPENAI_API_KEY=your_api_key_here
node test/test-python-executor-llm-e2e.js
```

## LLM Test Scenarios

The LLM E2E tests verify:

1. **Simple Calculation**: LLM uses the tool to calculate Fibonacci numbers
2. **File Analysis**: LLM analyzes a CSV file and decides to install pandas
3. **Error Handling**: LLM handles division by zero using try-except
4. **Data Processing with File Write**: LLM reads CSV data, installs pandas, processes it, and writes results to a local file

## Why Two Types of E2E Tests?

- **MCP Protocol Tests** (`test-python-executor-e2e.js`): Fast, deterministic, no external dependencies. Verify the tool works correctly through the MCP protocol.

- **LLM Integration Tests** (`test-python-executor-llm-e2e.js`): Verify that a real LLM can discover, understand, and use the tool correctly. Tests the tool's description, schema, and usability from an AI's perspective.

## Cost Considerations

The LLM E2E tests make API calls to OpenAI, which incur costs:
- Each test scenario uses GPT-4 (more expensive but better at tool use)
- Approximately 4-6 API calls per test run (4 test scenarios)
- Estimated cost: $0.01-0.07 per test run

Run these tests judiciously in CI/CD pipelines or manually when verifying LLM integration.
