import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ExecutePythonCodeArgsSchema, PACKAGE_NAME_REGEX } from './schemas.js';
import { ServerResult } from '../types.js';

/**
 * Grace period in milliseconds before sending SIGKILL after SIGTERM
 * Allows processes time to clean up gracefully before forced termination
 */
const KILL_GRACE_PERIOD_MS = 5000;

/**
 * Error message prefix for timeout errors
 * Used for consistent error reporting and easier testing
 */
export const TIMEOUT_ERROR_PREFIX = 'Execution timed out after';

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

  const { code, target_directory, install_packages, workspace, return_format } = parsed.data;
  
  // Auto-detect timeout: 120s if installing packages, 30s otherwise
  // If user explicitly sets a numeric timeout, always respect it
  let timeout_ms: number;
  if (parsed.data.timeout_ms === "auto") {
    timeout_ms = install_packages && install_packages.length > 0 ? 120000 : 30000;
  } else {
    timeout_ms = parsed.data.timeout_ms;
  }

  // Create a temporary directory for this execution
  const sessionId = `python-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempDir = path.join(os.tmpdir(), sessionId);
  const packagesDir = path.join(tempDir, 'packages');
  const scriptPath = path.join(tempDir, 'script.py');

  // Determine workspace directory
  let workspaceDir: string;
  if (workspace === "persistent") {
    // Use a persistent workspace directory in the user's home directory
    // NOTE: Concurrent executions with workspace="persistent" will share the same directory
    // without coordination. Use unique file names or subdirectories to avoid conflicts.
    const homeDir = os.homedir();
    workspaceDir = path.join(homeDir, '.desktop-commander', 'python-workspace');
    try {
      await fs.mkdir(workspaceDir, { recursive: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      let helpText = `Error: Failed to create persistent workspace directory at ${workspaceDir}: ${errorMessage}`;
      
      // Add helpful suggestions based on common error types
      if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
        helpText += '\n\nSuggestion: Check that you have write permissions to your home directory.';
      } else if (errorMessage.includes('ENOSPC') || errorMessage.includes('no space')) {
        helpText += '\n\nSuggestion: Free up disk space and try again.';
      } else if (errorMessage.includes('ENOTDIR')) {
        helpText += '\n\nSuggestion: A file exists at this path. Remove it or use a different workspace.';
      }
      
      return {
        content: [{
          type: "text",
          text: helpText
        }],
        isError: true
      };
    }
  } else if (workspace === "temp") {
    // Use the temporary directory for this execution (default behavior)
    workspaceDir = tempDir;
  } else {
    // Use custom path if provided
    // Resolve relative paths against current working directory
    // Absolute paths are normalized and trusted by design - callers providing absolute
    // paths are responsible for ensuring they're safe and don't access sensitive areas.
    if (path.isAbsolute(workspace)) {
      // Normalize to resolve any ".." sequences in absolute paths
      // Note: We normalize but don't restrict absolute paths as they're explicitly provided
      // by the caller who presumably knows what they're doing. For untrusted input,
      // use relative paths which are validated below.
      workspaceDir = path.normalize(workspace);
    } else {
      const customWorkspaceBaseDir = path.resolve(process.cwd());
      workspaceDir = path.resolve(customWorkspaceBaseDir, workspace);
      
      // Validate that relative paths don't escape the base directory via ".." traversal
      const relativeToBase = path.relative(customWorkspaceBaseDir, workspaceDir);
      if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
        return {
          content: [{
            type: "text",
            text: `Error: Invalid custom workspace directory "${workspace}". Relative paths must stay within the base directory ${customWorkspaceBaseDir}.`
          }],
          isError: true
        };
      }
    }
    
    try {
      await fs.mkdir(workspaceDir, { recursive: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      let helpText = `Error: Failed to create custom workspace directory at ${workspaceDir}: ${errorMessage}`;
      
      // Add helpful suggestions based on common error types
      if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
        helpText += '\n\nSuggestion: Check that you have write permissions to this directory.';
      } else if (errorMessage.includes('ENOSPC') || errorMessage.includes('no space')) {
        helpText += '\n\nSuggestion: Free up disk space and try again.';
      }
      
      return {
        content: [{
          type: "text",
          text: helpText
        }],
        isError: true
      };
    }
  }

  try {
    // Create directories
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(packagesDir, { recursive: true });

    // Resolve target directory
    // NOTE: If target_directory is specified, it takes precedence over workspace parameter.
    // This means workspace="persistent" is ignored when target_directory is provided.
    // Use workspace without target_directory to work in the persistent workspace,
    // or set target_directory explicitly to override workspace behavior.
    let resolvedTargetDir = target_directory;
    if (!resolvedTargetDir) {
      // Default to the workspace directory (persistent or temp based on workspace parameter)
      resolvedTargetDir = workspaceDir;
    } else if (!path.isAbsolute(resolvedTargetDir)) {
      resolvedTargetDir = path.resolve(process.cwd(), resolvedTargetDir);
    }

    // Verify target directory exists and is a directory
    try {
      const stats = await fs.stat(resolvedTargetDir);
      if (!stats.isDirectory()) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return {
          content: [{ type: "text", text: `Error: Target path is not a directory: ${resolvedTargetDir}` }],
          isError: true,
        };
      }
    } catch {
      await fs.rm(tempDir, { recursive: true, force: true });
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

    // Format result based on return_format
    let finalResult: ServerResult;
    if (return_format === "detailed" && !result.isError && result.content && result.content.length > 0) {
      // Add detailed information including workspace path
      const detailedText = result.content[0].text + 
        `\n\n--- Execution Details ---` +
        `\nWorkspace: file://${resolvedTargetDir.replace(/\\/g, '/')}` +
        `\nTimeout: ${timeout_ms}ms` +
        (install_packages && install_packages.length > 0 ? 
          `\nInstalled packages: ${install_packages.join(', ')}` : '');
      
      finalResult = {
        content: [{ type: "text", text: detailedText }],
        isError: false
      };
    } else {
      finalResult = result;
    }

    // Clean up - don't let cleanup errors prevent returning successful result
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Failed to clean up temporary Python execution directory:', {
        tempDir,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    return finalResult;

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
 * Escape a path for safe use in Python string literals.
 * Handles backslashes, quotes, and control characters that could break the string.
 */
function escapePythonString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "\\'")     // Escape single quotes
    .replace(/"/g, '\\"')     // Escape double quotes
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/\t/g, '\\t');   // Escape tabs
}

/**
 * Generate Python wrapper code that restricts filesystem access
 */
function generatePythonWrapper(userCode: string, targetDir: string, tempDir: string): string {
  // Escape directory paths for safe embedding in Python code
  const escapedTargetDir = escapePythonString(targetDir);
  const escapedTempDir = escapePythonString(tempDir);

  return `
import sys
import os

# Setup sandbox in a function to hide internals from user code
def _setup_sandbox():
    # Define allowed directories inside closure to prevent user code mutation
    allowed_dirs = [
        '${escapedTargetDir}',
        '${escapedTempDir}',
    ]
    
    # Store original functions in closure
    _original_open = open
    _original_listdir = os.listdir
    _original_mkdir = os.mkdir
    _original_makedirs = os.makedirs
    _original_remove = os.remove
    _original_rmdir = os.rmdir
    _original_unlink = os.unlink
    _original_rename = os.rename
    _original_replace = os.replace
    _original_symlink = os.symlink
    _original_link = os.link
    _original_chmod = os.chmod
    try:
        _original_chown = os.chown
    except AttributeError:
        _original_chown = None
    
    def _is_path_allowed(filepath):
        """Check if a file path is within allowed directories
        
        Uses realpath to resolve symbolic links and prevent path traversal attacks.
        Performs case-insensitive comparison on Windows.
        """
        try:
            # Convert PathLike objects to string
            filepath = os.fspath(filepath) if hasattr(os, 'fspath') else str(filepath)
            # Use realpath to resolve symlinks and normalize path
            real_path = os.path.realpath(os.path.expanduser(filepath))
            
            # On Windows, make comparison case-insensitive
            if sys.platform == 'win32':
                real_path = real_path.lower()
                
            for allowed_dir in allowed_dirs:
                allowed_real = os.path.realpath(os.path.expanduser(allowed_dir))
                if sys.platform == 'win32':
                    allowed_real = allowed_real.lower()
                    
                # Ensure the path actually starts with the allowed directory
                # Add separator to prevent partial matches (e.g., /tmp/x not matching /tmp/xyz)
                if real_path == allowed_real or real_path.startswith(allowed_real + os.sep):
                    return True
            return False
        except (OSError, ValueError, TypeError) as exc:
            sys.stderr.write(f"[sandbox] _is_path_allowed error for {filepath!r}: {exc}\\n")
            return False
        except Exception as exc:
            sys.stderr.write(f"[sandbox] unexpected error in _is_path_allowed for {filepath!r}: {exc}\\n")
            return False
    
    def _safe_open(file, mode='r', *args, **kwargs):
        """Wrapped open function that checks path access for both read and write"""
        # Allow reading from standard streams (file descriptors only)
        if file in (0, 1, 2):
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
    
    def _safe_rename(src, dst):
        """Wrapped rename that checks both source and destination paths"""
        if not _is_path_allowed(src):
            raise PermissionError(f"Access denied: source {src} is outside allowed directories")
        if not _is_path_allowed(dst):
            raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
        return _original_rename(src, dst)
    
    def _safe_replace(src, dst):
        """Wrapped replace that checks both source and destination paths"""
        if not _is_path_allowed(src):
            raise PermissionError(f"Access denied: source {src} is outside allowed directories")
        if not _is_path_allowed(dst):
            raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
        return _original_replace(src, dst)
    
    def _safe_symlink(src, dst):
        """Wrapped symlink that checks both source and destination paths.
        
        os.symlink(src, dst) creates a symlink at dst pointing to src.
        We ensure both src (the target) and dst (where the symlink is created)
        are within allowed directories.
        """
        if not _is_path_allowed(src):
            raise PermissionError(f"Access denied: source {src} is outside allowed directories")
        if not _is_path_allowed(dst):
            raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
        return _original_symlink(src, dst)
    
    def _safe_link(src, dst):
        """Wrapped link that checks both source and destination paths"""
        if not _is_path_allowed(src):
            raise PermissionError(f"Access denied: source {src} is outside allowed directories")
        if not _is_path_allowed(dst):
            raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
        return _original_link(src, dst)
    
    def _safe_chmod(path, mode):
        """Wrapped chmod that checks path access"""
        if not _is_path_allowed(path):
            raise PermissionError(f"Access denied: {path} is outside allowed directories")
        return _original_chmod(path, mode)
    
    def _safe_chown(path, uid, gid):
        """Wrapped chown that checks path access"""
        if _original_chown is None:
            raise AttributeError("os.chown is not available on this platform")
        if not _is_path_allowed(path):
            raise PermissionError(f"Access denied: {path} is outside allowed directories")
        return _original_chown(path, uid, gid)
    
    # Replace built-in functions
    import builtins
    builtins.open = _safe_open
    os.listdir = _safe_listdir
    os.mkdir = _safe_mkdir
    os.makedirs = _safe_makedirs
    os.remove = _safe_remove
    os.rmdir = _safe_rmdir
    os.unlink = _safe_unlink
    os.rename = _safe_rename
    os.replace = _safe_replace
    os.symlink = _safe_symlink
    os.link = _safe_link
    os.chmod = _safe_chmod
    if _original_chown is not None:
        os.chown = _safe_chown
    
    # NOTE: Lower-level operations like os.open(), os.stat(), os.lstat(), os.access(),
    # os.scandir(), and os.walk() are NOT wrapped by this sandbox. These functions
    # could potentially be used to bypass the sandbox restrictions. The sandbox wraps
    # the most commonly used high-level filesystem operations to provide a reasonable
    # level of protection for typical Python code execution scenarios.
    
    # Wrap shutil functions that perform filesystem operations
    try:
        import shutil
        _original_shutil_copy = shutil.copy
        _original_shutil_copy2 = shutil.copy2
        _original_shutil_copyfile = shutil.copyfile
        _original_shutil_move = shutil.move
        _original_shutil_rmtree = shutil.rmtree
        _original_shutil_copytree = shutil.copytree
        
        def _safe_shutil_copy(src, dst, *args, **kwargs):
            if not _is_path_allowed(src):
                raise PermissionError(f"Access denied: source {src} is outside allowed directories")
            if not _is_path_allowed(dst):
                raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
            return _original_shutil_copy(src, dst, *args, **kwargs)
        
        def _safe_shutil_copy2(src, dst, *args, **kwargs):
            if not _is_path_allowed(src):
                raise PermissionError(f"Access denied: source {src} is outside allowed directories")
            if not _is_path_allowed(dst):
                raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
            return _original_shutil_copy2(src, dst, *args, **kwargs)
        
        def _safe_shutil_copyfile(src, dst, *args, **kwargs):
            if not _is_path_allowed(src):
                raise PermissionError(f"Access denied: source {src} is outside allowed directories")
            if not _is_path_allowed(dst):
                raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
            return _original_shutil_copyfile(src, dst, *args, **kwargs)
        
        def _safe_shutil_move(src, dst, *args, **kwargs):
            if not _is_path_allowed(src):
                raise PermissionError(f"Access denied: source {src} is outside allowed directories")
            if not _is_path_allowed(dst):
                raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
            return _original_shutil_move(src, dst, *args, **kwargs)
        
        def _safe_shutil_rmtree(path, *args, **kwargs):
            if not _is_path_allowed(path):
                raise PermissionError(f"Access denied: {path} is outside allowed directories")
            return _original_shutil_rmtree(path, *args, **kwargs)
        
        def _safe_shutil_copytree(src, dst, *args, **kwargs):
            if not _is_path_allowed(src):
                raise PermissionError(f"Access denied: source {src} is outside allowed directories")
            if not _is_path_allowed(dst):
                raise PermissionError(f"Access denied: destination {dst} is outside allowed directories")
            return _original_shutil_copytree(src, dst, *args, **kwargs)
        
        shutil.copy = _safe_shutil_copy
        shutil.copy2 = _safe_shutil_copy2
        shutil.copyfile = _safe_shutil_copyfile
        shutil.move = _safe_shutil_move
        shutil.rmtree = _safe_shutil_rmtree
        shutil.copytree = _safe_shutil_copytree
    except ImportError:
        pass  # shutil not available
    
    # Wrap pathlib.Path methods
    try:
        import pathlib
        from pathlib import Path as _OriginalPath
        
        # Get the concrete Path class (PosixPath or WindowsPath)
        _ConcretePathClass = type(_OriginalPath())
        
        class _SafePath(_ConcretePathClass):
            def _check_access(self):
                if not _is_path_allowed(str(self)):
                    raise PermissionError(f"Access denied: {self} is outside allowed directories")
            
            def touch(self, *args, **kwargs):
                self._check_access()
                return super().touch(*args, **kwargs)
            
            def write_text(self, *args, **kwargs):
                self._check_access()
                return super().write_text(*args, **kwargs)
            
            def write_bytes(self, *args, **kwargs):
                self._check_access()
                return super().write_bytes(*args, **kwargs)
            
            def mkdir(self, *args, **kwargs):
                self._check_access()
                return super().mkdir(*args, **kwargs)
            
            def rmdir(self, *args, **kwargs):
                self._check_access()
                return super().rmdir(*args, **kwargs)
            
            def unlink(self, *args, **kwargs):
                self._check_access()
                return super().unlink(*args, **kwargs)
            
            def rename(self, target):
                self._check_access()
                if not _is_path_allowed(str(target)):
                    raise PermissionError(f"Access denied: {target} is outside allowed directories")
                return super().rename(target)
            
            def replace(self, target):
                self._check_access()
                if not _is_path_allowed(str(target)):
                    raise PermissionError(f"Access denied: {target} is outside allowed directories")
                return super().replace(target)
            
            def symlink_to(self, target):
                # symlink_to creates a symlink at self pointing to target
                # Both the symlink location (self) and the target must be within allowed directories
                self._check_access()
                if not _is_path_allowed(str(target)):
                    raise PermissionError(f"Access denied: {target} is outside allowed directories")
                return super().symlink_to(target)
            
            def link_to(self, target):
                # link_to creates a hard link at target pointing to self
                # Hard links require both paths to be accessible and on the same filesystem
                self._check_access()
                if not _is_path_allowed(str(target)):
                    raise PermissionError(f"Access denied: {target} is outside allowed directories")
                return super().link_to(target)
            
            def chmod(self, mode):
                self._check_access()
                return super().chmod(mode)
            
            def open(self, *args, **kwargs):
                self._check_access()
                return _safe_open(str(self), *args, **kwargs)
            
            def read_text(self, *args, **kwargs):
                self._check_access()
                return super().read_text(*args, **kwargs)
            
            def read_bytes(self):
                self._check_access()
                return super().read_bytes()
            
            def iterdir(self):
                self._check_access()
                return super().iterdir()
            
            def glob(self, pattern):
                self._check_access()
                return super().glob(pattern)
            
            def rglob(self, pattern):
                self._check_access()
                return super().rglob(pattern)
        
        # Replace pathlib.Path in sys.modules
        pathlib.Path = _SafePath
        import sys
        sys.modules['pathlib'].Path = _SafePath
    except (ImportError, TypeError):
        # pathlib not available or subclassing failed
        pass
    
    # Wrap tempfile to use allowed directories
    try:
        import tempfile as _tempfile_module
        _original_mkstemp = _tempfile_module.mkstemp
        _original_mkdtemp = _tempfile_module.mkdtemp
        _original_NamedTemporaryFile = _tempfile_module.NamedTemporaryFile
        _original_TemporaryDirectory = _tempfile_module.TemporaryDirectory
        
        def _safe_mkstemp(*args, **kwargs):
            # Validate user-provided dir; default to allowed temp directory if none provided
            if 'dir' in kwargs:
                if not _is_path_allowed(kwargs['dir']):
                    raise PermissionError(f"Access denied: {kwargs['dir']} is outside allowed directories")
            else:
                kwargs['dir'] = '${escapedTempDir}'
            return _original_mkstemp(*args, **kwargs)
        
        def _safe_mkdtemp(*args, **kwargs):
            # Validate user-provided dir; default to allowed temp directory if none provided
            if 'dir' in kwargs:
                if not _is_path_allowed(kwargs['dir']):
                    raise PermissionError(f"Access denied: {kwargs['dir']} is outside allowed directories")
            else:
                kwargs['dir'] = '${escapedTempDir}'
            return _original_mkdtemp(*args, **kwargs)
        
        def _safe_NamedTemporaryFile(*args, **kwargs):
            # Validate user-provided dir; default to allowed temp directory if none provided
            if 'dir' in kwargs:
                if not _is_path_allowed(kwargs['dir']):
                    raise PermissionError(f"Access denied: {kwargs['dir']} is outside allowed directories")
            else:
                kwargs['dir'] = '${escapedTempDir}'
            return _original_NamedTemporaryFile(*args, **kwargs)
        
        def _safe_TemporaryDirectory(*args, **kwargs):
            # Validate user-provided dir; default to allowed temp directory if none provided
            if 'dir' in kwargs:
                if not _is_path_allowed(kwargs['dir']):
                    raise PermissionError(f"Access denied: {kwargs['dir']} is outside allowed directories")
            else:
                kwargs['dir'] = '${escapedTempDir}'
            return _original_TemporaryDirectory(*args, **kwargs)
        
        _tempfile_module.mkstemp = _safe_mkstemp
        _tempfile_module.mkdtemp = _safe_mkdtemp
        _tempfile_module.NamedTemporaryFile = _safe_NamedTemporaryFile
        _tempfile_module.TemporaryDirectory = _safe_TemporaryDirectory
    except ImportError:
        pass  # tempfile not available

# Run sandbox setup and then delete it to hide internals from user code
_setup_sandbox()
del _setup_sandbox

# Set working directory to target directory
os.chdir('${escapedTargetDir}')

# Execute user code with isolated namespace
import base64 as _py_executor_base64

try:
    __py_executor_internal_user_code_bytes__ = _py_executor_base64.b64decode('${Buffer.from(userCode, 'utf8').toString('base64')}')
    __py_executor_internal_user_code__ = __py_executor_internal_user_code_bytes__.decode('utf-8')
    
    # Build a restricted globals dictionary for user code execution
    # This isolates user code from internal wrapper variables and provides a clean namespace
    # Note: The sandboxed open, os functions, etc. are already in builtins and os module
    # after _setup_sandbox() ran, so we just need to provide a minimal clean namespace
    __py_executor_internal_exec_globals__ = {
        '__builtins__': __builtins__,
        'os': os,
        'sys': sys,
    }
    __py_executor_internal_exec_locals__ = {}
    
    exec(__py_executor_internal_user_code__, __py_executor_internal_exec_globals__, __py_executor_internal_exec_locals__)
except Exception as e:
    import traceback
    print(f"Error executing code: {e}", file=sys.stderr)
    traceback.print_exc()
    sys.exit(1)
`;
}

/**
 * Build a minimal whitelisted environment to avoid leaking secrets
 * 
 * This function creates a minimal set of environment variables for Python subprocesses.
 * By using a whitelist approach, we prevent secrets (API keys, tokens, etc.) that may
 * exist in the server's process.env from being exposed to Python code or package install scripts.
 * 
 * Included variables:
 * - PATH: Required for Python and pip to find executables
 * - HOME: Used by Python for user site-packages and config files
 * - TMPDIR/TEMP/TMP: Required for temporary file operations
 * - Platform-specific (Windows): SYSTEMROOT, WINDIR, USERNAME, USERPROFILE, APPDATA, LOCALAPPDATA
 * - Platform-specific (Unix): USER, LOGNAME, LANG, LC_ALL
 * 
 * Empty variables are filtered out to avoid confusion in Python code.
 * 
 * Note: PYTHONPATH is intentionally NOT included here. It is managed separately in
 * executePythonScript() where it's explicitly set to control the Python module search path
 * for security reasons. This prevents any potentially malicious PYTHONPATH settings from
 * the parent environment from affecting the sandboxed execution.
 * 
 * @returns A minimal environment object safe for use with Python subprocesses
 */
function buildMinimalEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || '',
    TEMP: process.env.TEMP || '',
    TMP: process.env.TMP || '',
    // Platform-specific essentials
    ...(process.platform === 'win32' ? {
      SYSTEMROOT: process.env.SYSTEMROOT || '',
      WINDIR: process.env.WINDIR || '',
      USERNAME: process.env.USERNAME || '',
      // Python/pip often rely on these directories on Windows
      USERPROFILE: process.env.USERPROFILE || '',
      APPDATA: process.env.APPDATA || '',
      LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    } : {
      USER: process.env.USER || '',
      LOGNAME: process.env.LOGNAME || '',
      // Common locale settings that Python may need
      LANG: process.env.LANG || '',
      LC_ALL: process.env.LC_ALL || '',
    }),
  };

  // Remove variables that are missing in the parent environment (value === '')
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== '')
  );
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

  // Validate package names to prevent argument injection and ensure validity
  // Note: Schema validation already checks most of these, but we add runtime checks for defense in depth
  for (const pkg of packages) {
    // Check for packages starting with '-' to prevent argument injection
    if (pkg.startsWith('-')) {
      return {
        content: [{
          type: "text",
          text: `Error: Invalid package name '${pkg}'. Package names cannot start with '-' to prevent argument injection.`
        }],
        isError: true
      };
    }
    
    // Check for invalid characters (aligned with schema validation)
    // This provides defense in depth against shell injection even though spawn() with array args mitigates it
    if (!PACKAGE_NAME_REGEX.test(pkg)) {
      return {
        content: [{
          type: "text",
          text: `Error: Invalid package name '${pkg}'. Package names may only contain letters, digits, '_', '.', '-', and version specifiers ([, ], !, =, <, >, ,).`
        }],
        isError: true
      };
    }
  }

  return new Promise((resolve) => {
    const args = ['-m', 'pip', 'install', '--target', packagesDir, ...packages];
    const env = buildMinimalEnvironment();
    
    // Force UTF-8 encoding on Windows to prevent charmap codec errors
    if (process.platform === 'win32') {
      env.PYTHONIOENCODING = 'utf-8';
      env.PYTHONUTF8 = '1';
    }
    
    const proc = spawn(pythonCmd, args, { env });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;
    let killTimeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    // Set up timeout with two-stage termination
    if (timeout_ms > 0) {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        proc.kill('SIGTERM');
        
        // If process doesn't exit after SIGTERM, force kill after grace period
        killTimeoutId = setTimeout(() => {
          // Only send SIGKILL if process hasn't exited yet
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
          }
        }, KILL_GRACE_PERIOD_MS);
      }, timeout_ms);
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Use 'close' event instead of 'exit': 'close' fires after all stdio streams are closed,
    // ensuring we've captured all output. 'exit' can fire before stdio is fully read.
    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimeoutId) clearTimeout(killTimeoutId);

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
        // Include progress output if available
        let installMessage = `Successfully installed packages: ${packages.join(', ')}`;
        if (stdout && stdout.trim()) {
          // Extract key information from pip output, filtering out noisy progress lines
          const lines = stdout.trim().split('\n');
          const meaningfulLines = lines.filter((line) => {
            const trimmed = line.trim();
            return (
              trimmed.startsWith('Successfully installed') ||
              trimmed.startsWith('Requirement already satisfied') ||
              trimmed.startsWith('ERROR:') ||
              trimmed.startsWith('WARNING:') ||
              trimmed.startsWith('Failed') ||
              trimmed.startsWith('Collecting ')
            );
          });

          let summary: string;
          if (meaningfulLines.length > 0) {
            summary = meaningfulLines.join('\n');
          } else {
            // Fallback: show the last few non-empty lines for context
            const nonEmptyLines = lines.map(l => l.trim()).filter(l => l.length > 0);
            summary = nonEmptyLines.slice(-5).join('\n');
          }

          if (summary && summary.trim()) {
            installMessage += `\n\nInstallation summary:\n${summary}`;
          }
        }
        resolve({
          content: [{
            type: "text",
            text: installMessage
          }]
        });
      }
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimeoutId) clearTimeout(killTimeoutId);
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
    const env = buildMinimalEnvironment();
    
    // Add only the managed packages directory to PYTHONPATH to avoid leaking host env
    env.PYTHONPATH = packagesDir;
    
    // Force UTF-8 encoding on Windows to prevent charmap codec errors
    if (process.platform === 'win32') {
      env.PYTHONIOENCODING = 'utf-8';
      env.PYTHONUTF8 = '1';
    }

    const proc = spawn(pythonCmd, [scriptPath], {
      env
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;
    let killTimeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    // Set up timeout with two-stage termination
    if (timeout_ms > 0) {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        proc.kill('SIGTERM');
        
        // If process doesn't exit after SIGTERM, force kill after grace period
        killTimeoutId = setTimeout(() => {
          // Only send SIGKILL if process hasn't exited yet
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
          }
        }, KILL_GRACE_PERIOD_MS);
      }, timeout_ms);
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Use 'close' event instead of 'exit': 'close' fires after all stdio streams are closed,
    // ensuring we've captured all output. 'exit' can fire before stdio is fully read.
    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killTimeoutId) clearTimeout(killTimeoutId);

      if (isTimedOut) {
        resolve({
          content: [{
            type: "text",
            text: `${TIMEOUT_ERROR_PREFIX} ${timeout_ms}ms\n\nPartial output:\n${stdout}\n${stderr}`
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
      if (killTimeoutId) clearTimeout(killTimeoutId);
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
        
        let versionOutput = '';
        
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);
        
        const cleanup = () => {
          clearTimeout(timeout);
        };
        
        // Capture version output
        proc.stdout.on('data', (data) => {
          versionOutput += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
          versionOutput += data.toString();
        });
        
        // Use 'close' event: ensures process has fully terminated and all stdio is closed
        proc.on('close', (code) => {
          cleanup();
          
          if (code !== 0) {
            resolve(false);
            return;
          }
          
          // Parse version output to ensure it's Python 3
          // Example output: "Python 3.11.0" or "Python 3.9.7"
          const versionMatch = versionOutput.match(/^Python\s+(\d+)\.(\d+)/im);
          if (versionMatch) {
            const majorVersion = parseInt(versionMatch[1], 10);
            // Require Python 3 or higher
            resolve(majorVersion >= 3);
          } else {
            // If we can't parse version, reject to be safe
            resolve(false);
          }
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
