# GitHub Actions Workflows

This directory contains CI/CD workflows for the Desktop Commander MCP project.

## Workflows

### 1. Build (`build.yml`)

**Trigger**: Push to main, Pull Requests  
**Purpose**: Verify the project builds successfully across different Node.js versions

**What it does**:
- Tests builds on Node.js 18.x and 20.x
- Installs dependencies (skipping Puppeteer downloads)
- Compiles TypeScript to JavaScript
- Verifies build artifacts are created
- Uploads build artifacts for inspection

**Status Badge**:
```markdown
![Build](https://github.com/andriyshevchenko/DesktopCommanderMCP/workflows/Build/badge.svg)
```

### 2. Test (`test.yml`)

**Trigger**: Push to main, Pull Requests  
**Purpose**: Run unit tests across multiple Node.js and Python versions

**What it does**:
- Matrix testing: Node.js (18.x, 20.x) × Python (3.9, 3.10, 3.11, 3.12)
- Verifies Python installation and pip availability
- Runs Python executor unit tests
- Runs full test suite

**Why multiple Python versions?**  
The `execute_python_code` tool requires Python to be installed. Testing across multiple Python versions ensures compatibility.

**Status Badge**:
```markdown
![Test](https://github.com/andriyshevchenko/DesktopCommanderMCP/workflows/Test/badge.svg)
```

### 3. E2E Tests (`e2e.yml`)

**Trigger**: Push to main, Pull Requests, Manual dispatch  
**Purpose**: Run end-to-end tests with real MCP server and optionally with real LLM

**Jobs**:

#### 3a. E2E MCP Protocol Tests (`e2e-mcp`)
- **Always runs** on push/PR
- Tests real MCP Client/Server communication
- Matrix: Node.js (18.x, 20.x) × Python (3.9, 3.10, 3.11, 3.12)
- Timeout: 10 minutes
- Tests tool registration, execution, sandboxing
- Network tests (package installation) are currently skipped in CI

#### 3b. E2E LLM Integration Tests (`e2e-llm`)
- **Runs automatically on push/PR** if `OPENAI_API_KEY` secret is configured
- **Can also be triggered manually** with `run_llm_tests` input
- Tests real OpenAI GPT-4 integration
- Gracefully skips if `OPENAI_API_KEY` is not available
- Node.js 20.x, Python 3.11
- Timeout: 15 minutes

**Behavior**:
- **With OPENAI_API_KEY**: Tests run automatically on every push/PR
- **Without OPENAI_API_KEY**: Tests are skipped (workflow doesn't fail)
- **Manual trigger**: Always available via workflow_dispatch

**Why run LLM tests on push?**  
With the secret configured, LLM tests provide valuable validation that the tool works with real AI. The tests:
- Verify LLM can discover and use the tool correctly
- Test real-world AI interaction patterns
- Cost is minimal (~$0.01-0.05 per run)
- Can be disabled by removing the secret

**Running LLM tests manually** (without configuring secret):
1. Go to Actions tab in GitHub
2. Select "E2E Tests" workflow
3. Click "Run workflow"
4. Check "Run LLM tests" option
5. Click "Run workflow"
6. Note: Will fail if OPENAI_API_KEY is not configured

**Status Badge**:
```markdown
![E2E Tests](https://github.com/andriyshevchenko/DesktopCommanderMCP/workflows/E2E%20Tests/badge.svg)
```

### 4. Codespell (`codespell.yml`)

**Trigger**: Push to main, Pull Requests  
**Purpose**: Check for spelling errors in code and documentation

**What it does**:
- Uses codespell to find typos
- Annotates locations with typos in PR
- Configuration in `.codespellrc`

## Setting Up Secrets

### OPENAI_API_KEY (Optional, but Recommended)

Configuring this secret enables automatic LLM E2E tests on every push/PR.

**Benefits of configuring**:
- Automatic validation that LLM can use the tool
- Continuous testing of AI integration
- Early detection of issues with tool discoverability
- Minimal cost (~$0.01-0.05 per test run)

**To add the secret**:
1. Go to repository Settings
2. Navigate to Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `OPENAI_API_KEY`
5. Value: Your OpenAI API key
6. Click "Add secret"

## Workflow Dependencies

Note: These workflows run independently in parallel - there are no automatic dependencies between them. Each workflow is triggered by the same events (push to main, pull requests).

```
build.yml        (independent)
test.yml         (independent)
e2e.yml          (independent)
  ├─ e2e-mcp     (always runs)
  └─ e2e-llm     (runs on push/PR when `OPENAI_API_KEY` is set; can also be triggered manually)
```

## Matrix Testing Strategy

### Node.js Versions
- **18.x**: LTS (Long Term Support)
- **20.x**: Current LTS

### Python Versions
- **3.9**: Older stable version
- **3.10-3.12**: Current stable versions

This ensures the `execute_python_code` tool works with commonly used Python versions.

## Troubleshooting

### Build fails with "Puppeteer download error"
- **Solution**: Workflows use `PUPPETEER_SKIP_DOWNLOAD=true` to skip Puppeteer browser downloads
- **Why**: Desktop Commander doesn't need Puppeteer browsers for core functionality

### Test fails with "Python not found"
- **Solution**: Workflows include Python setup step
- **Verify**: Check Python version matrix in workflow

### E2E LLM tests fail
- **Check**: `OPENAI_API_KEY` secret is configured
- **Check**: API key has sufficient credits
- **Check**: No rate limiting issues with OpenAI API

### Timeout errors
- **Build**: Should complete in < 5 minutes
- **Tests**: Should complete in < 10 minutes
- **E2E MCP**: Should complete in < 10 minutes
- **E2E LLM**: Should complete in < 15 minutes

If timeouts occur, investigate slow package installations or network issues.

## Local Testing

Run the same tests locally before pushing:

```bash
# Build
npm run build

# Unit tests
node test/test-python-executor.js

# All tests
npm test

# E2E MCP tests
node test/test-python-executor-e2e.js

# E2E LLM tests (requires OPENAI_API_KEY)
OPENAI_API_KEY=your_key node test/test-python-executor-llm-e2e.js
```

## Skipping Workflows

Add to commit message to skip workflows:
- `[skip ci]` - Skip all workflows
- `[skip build]` - Skip build workflow
- `[skip tests]` - Skip test workflow

**Note**: Not recommended unless making documentation-only changes.
