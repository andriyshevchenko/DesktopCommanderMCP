import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ExecutePythonCodeArgsSchema } from './schemas.js';
import { ServerResult } from '../types.js';

/**
 * Execute Python code in a sandboxed environment with limited filesystem access
 * and automatic package installation
 */
export async function executePythonCode(args: unknown): Promise<ServerResult> {
  const parsed = ExecutePythonCodeArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Error: Invalid arguments for execute_python_code: ${parsed.error}` }],
      isError: true,
    };
  }

  const { code, target_directory, timeout_ms, install_packages } = parsed.data;

  // Create a temporary directory for this execution
  const sessionId = `python-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempDir = path.join(os.tmpdir(), sessionId);
  const packagesDir = path.join(tempDir, 'packages');
  const scriptPath = path.join(tempDir, 'script.py');

  try {
    // Create directories
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(packagesDir, { recursive: true });

    // Resolve target directory
    let resolvedTargetDir = target_directory;
    if (!resolvedTargetDir) {
      resolvedTargetDir = process.cwd();
    } else if (!path.isAbsolute(resolvedTargetDir)) {
      resolvedTargetDir = path.resolve(process.cwd(), resolvedTargetDir);
    }

    // Verify target directory exists
    try {
      await fs.access(resolvedTargetDir);
    } catch {
      return {
        content: [{ type: "text", text: `Error: Target directory does not exist: ${resolvedTargetDir}` }],
        isError: true,
      };
    }

    // Create a wrapper script that sets up the environment
    const wrapperCode = generatePythonWrapper(code, resolvedTargetDir, tempDir);
    await fs.writeFile(scriptPath, wrapperCode, 'utf8');

    // Install packages if requested
    if (install_packages && install_packages.length > 0) {
      const installResult = await installPythonPackages(packagesDir, install_packages, timeout_ms);
      if (installResult.isError) {
        // Clean up
        await fs.rm(tempDir, { recursive: true, force: true });
        return installResult;
      }
    }

    // Execute the script
    const result = await executePythonScript(scriptPath, packagesDir, timeout_ms);

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });

    return result;

  } catch (error) {
    // Ensure cleanup on error
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Failed to clean up temporary Python execution directory:', {
        tempDir,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    return {
      content: [{
        type: "text",
        text: `Failed to execute Python code: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Generate Python wrapper code that restricts filesystem access
 */
function generatePythonWrapper(userCode: string, targetDir: string, tempDir: string): string {
  // Escape strings for Python
  const escapedTargetDir = targetDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const escapedTempDir = tempDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `
import sys
import os

# Define allowed directories
ALLOWED_DIRS = [
    '${escapedTargetDir}',
    '${escapedTempDir}',
]

# Store original functions
_original_open = open
_original_listdir = os.listdir
_original_mkdir = os.mkdir
_original_makedirs = os.makedirs
_original_remove = os.remove
_original_rmdir = os.rmdir
_original_unlink = os.unlink

def _is_path_allowed(filepath):
    """Check if a file path is within allowed directories
    
    Uses realpath to resolve symbolic links and prevent path traversal attacks.
    Performs case-insensitive comparison on Windows.
    """
    try:
        # Use realpath to resolve symlinks and normalize path
        real_path = os.path.realpath(os.path.expanduser(filepath))
        
        # On Windows, make comparison case-insensitive
        if sys.platform == 'win32':
            real_path = real_path.lower()
            
        for allowed_dir in ALLOWED_DIRS:
            allowed_real = os.path.realpath(os.path.expanduser(allowed_dir))
            if sys.platform == 'win32':
                allowed_real = allowed_real.lower()
                
            # Ensure the path actually starts with the allowed directory
            # Add separator to prevent partial matches (e.g., /tmp/x not matching /tmp/xyz)
            if real_path == allowed_real or real_path.startswith(allowed_real + os.sep):
                return True
        return False
    except (OSError, ValueError) as exc:
        sys.stderr.write(f"[sandbox] _is_path_allowed error for {filepath!r}: {exc}\\n")
        return False
    except Exception as exc:
        sys.stderr.write(f"[sandbox] unexpected error in _is_path_allowed for {filepath!r}: {exc}\\n")
        return False

def _safe_open(file, mode='r', *args, **kwargs):
    """Wrapped open function that checks path access for both read and write"""
    # Allow reading from standard streams
    if file in (0, 1, 2) or hasattr(file, 'read'):
        return _original_open(file, mode, *args, **kwargs)
    
    # Check if path is allowed for all file operations
    if not _is_path_allowed(file):
        raise PermissionError(f"Access denied: {file} is outside allowed directories")
    
    return _original_open(file, mode, *args, **kwargs)

def _safe_listdir(path='.'):
    """Wrapped listdir that checks path access"""
    if not _is_path_allowed(path):
        raise PermissionError(f"Access denied: {path} is outside allowed directories")
    return _original_listdir(path)

def _safe_mkdir(path, *args, **kwargs):
    """Wrapped mkdir that checks path access"""
    if not _is_path_allowed(path):
        raise PermissionError(f"Access denied: {path} is outside allowed directories")
    return _original_mkdir(path, *args, **kwargs)

def _safe_makedirs(name, *args, **kwargs):
    """Wrapped makedirs that checks path access"""
    if not _is_path_allowed(name):
        raise PermissionError(f"Access denied: {name} is outside allowed directories")
    return _original_makedirs(name, *args, **kwargs)

def _safe_remove(path):
    """Wrapped remove that checks path access"""
    if not _is_path_allowed(path):
        raise PermissionError(f"Access denied: {path} is outside allowed directories")
    return _original_remove(path)

def _safe_rmdir(path):
    """Wrapped rmdir that checks path access"""
    if not _is_path_allowed(path):
        raise PermissionError(f"Access denied: {path} is outside allowed directories")
    return _original_rmdir(path)

def _safe_unlink(path):
    """Wrapped unlink that checks path access"""
    if not _is_path_allowed(path):
        raise PermissionError(f"Access denied: {path} is outside allowed directories")
    return _original_unlink(path)

# Replace built-in functions
import builtins
builtins.open = _safe_open
os.listdir = _safe_listdir
os.mkdir = _safe_mkdir
os.makedirs = _safe_makedirs
os.remove = _safe_remove
os.rmdir = _safe_rmdir
os.unlink = _safe_unlink

# Set working directory to target directory
os.chdir('${escapedTargetDir}')

# Execute user code
try:
${userCode.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    import traceback
    print(f"Error executing code: {e}", file=sys.stderr)
    traceback.print_exc()
    sys.exit(1)
`;
}

/**
 * Install Python packages using pip
 */
async function installPythonPackages(
  packagesDir: string,
  packages: string[],
  timeout_ms: number
): Promise<ServerResult> {
  const pythonCmd = await findPythonCommand();
  if (!pythonCmd) {
    return {
      content: [{
        type: "text",
        text: "Error: Python is not installed or not found in PATH. Please install Python 3 to use this tool."
      }],
      isError: true
    };
  }

  return new Promise((resolve) => {
    const args = ['-m', 'pip', 'install', '--target', packagesDir, ...packages];
    const proc = spawn(pythonCmd, args);

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    // Set up timeout
    if (timeout_ms > 0) {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        proc.kill('SIGTERM');
      }, timeout_ms);
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (isTimedOut) {
        resolve({
          content: [{
            type: "text",
            text: `Failed to install packages: ${packages.join(', ')} - Timeout after ${timeout_ms}ms`
          }],
          isError: true
        });
      } else if (exitCode !== 0) {
        resolve({
          content: [{
            type: "text",
            text: `Failed to install packages: ${packages.join(', ')}\n\nError:\n${stderr}\n${stdout}`
          }],
          isError: true
        });
      } else {
        resolve({
          content: [{
            type: "text",
            text: `Successfully installed packages: ${packages.join(', ')}`
          }]
        });
      }
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        content: [{
          type: "text",
          text: `Failed to install packages: ${err.message}`
        }],
        isError: true
      });
    });
  });
}

/**
 * Execute a Python script
 */
async function executePythonScript(
  scriptPath: string,
  packagesDir: string,
  timeout_ms: number
): Promise<ServerResult> {
  const pythonCmd = await findPythonCommand();
  if (!pythonCmd) {
    return {
      content: [{
        type: "text",
        text: "Error: Python is not installed or not found in PATH. Please install Python 3 to use this tool."
      }],
      isError: true
    };
  }

  return new Promise((resolve) => {
    const env = { ...process.env };
    
    // Add packages directory to PYTHONPATH
    if (env.PYTHONPATH) {
      env.PYTHONPATH = `${packagesDir}${path.delimiter}${env.PYTHONPATH}`;
    } else {
      env.PYTHONPATH = packagesDir;
    }

    const proc = spawn(pythonCmd, [scriptPath], {
      env
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    // Set up timeout
    if (timeout_ms > 0) {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        proc.kill('SIGTERM');
      }, timeout_ms);
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (isTimedOut) {
        resolve({
          content: [{
            type: "text",
            text: `Execution timed out after ${timeout_ms}ms\n\nPartial output:\n${stdout}\n${stderr}`
          }],
          isError: true
        });
      } else if (exitCode !== 0) {
        resolve({
          content: [{
            type: "text",
            text: `Execution failed (exit code ${exitCode}):\n${stderr}\n${stdout}`
          }],
          isError: true
        });
      } else {
        // Return stdout, and include stderr if it has warnings
        let output = stdout || '(no output)';
        if (stderr && stderr.trim()) {
          output += `\n\nWarnings/Info:\n${stderr}`;
        }
        resolve({
          content: [{
            type: "text",
            text: output
          }]
        });
      }
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        content: [{
          type: "text",
          text: `Failed to execute Python script: ${err.message}`
        }],
        isError: true
      });
    });
  });
}

/**
 * Find available Python command (python3 or python)
 */
async function findPythonCommand(): Promise<string | null> {
  const commands = ['python3', 'python'];
  
  for (const cmd of commands) {
    try {
      const result = await new Promise<boolean>((resolve) => {
        const proc = spawn(cmd, ['--version']);
        
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);
        
        const cleanup = () => {
          clearTimeout(timeout);
        };
        
        proc.on('close', (code) => {
          cleanup();
          resolve(code === 0);
        });
        
        proc.on('error', () => {
          cleanup();
          resolve(false);
        });
      });
      
      if (result) {
        return cmd;
      }
    } catch {
      continue;
    }
  }
  
  return null;
}
