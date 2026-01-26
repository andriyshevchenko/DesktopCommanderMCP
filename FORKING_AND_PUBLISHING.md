# Forking and Publishing Your Own NPM Package

This guide explains how to fork this repository and publish it as your own npm package.

## Prerequisites

1. **NPM Account**: Create an account at [npmjs.com](https://www.npmjs.com/)
2. **NPM Authentication**: Login to npm on your local machine:
   ```bash
   npm login
   ```
3. **Git Setup**: Ensure you have a GitHub account and git configured

## Steps to Fork and Publish

### 1. Update Package Metadata

Edit `package.json` to reflect your ownership:

```json
{
  "name": "@your-username/your-package-name",
  "version": "1.0.0",
  "description": "Your description here",
  "author": "Your Name",
  "homepage": "https://github.com/your-username/your-repo-name",
  "bugs": "https://github.com/your-username/your-repo-name/issues",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/your-username/your-repo-name.git"
  }
}
```

**Important fields to update:**
- `name`: Use a scoped package name like `@your-username/package-name` or an unscoped name if available
- `version`: Start with `1.0.0` or your desired initial version
- `author`: Your name or organization
- `homepage`: Your repository URL
- `bugs`: Your issues page URL
- `repository.url`: Your repository git URL

### 2. Update MCP Name (Optional)

If you're publishing to the MCP registry, update the MCP name in `package.json`:

```json
{
  "mcpName": "io.github.your-username/your-package-name"
}
```

### 3. Update Documentation

Update the following files to reflect your fork:
- `README.md`: Update installation instructions, badges, and repository links
- `LICENSE`: Update copyright holder if needed (respect the original MIT license)
- Remove or update `PUBLISH.md` with your publishing workflow

### 4. Configure NPM Publishing

Ensure `package.json` has the correct publish configuration:

```json
{
  "publishConfig": {
    "access": "public"
  },
  "files": [
    "dist",
    "logo.png",
    "testemonials"
  ]
}
```

The `files` array specifies what gets published to npm. The project is configured to publish:
- `dist/` - Compiled JavaScript files
- `logo.png` - Package logo
- `testemonials/` - Testimonials directory

### 5. Build the Project

Before publishing, ensure the project builds successfully:

```bash
npm install
npm run build
```

This will:
- Install all dependencies
- Compile TypeScript to JavaScript in the `dist/` directory
- Copy necessary files to `dist/`

### 6. Test Locally (Optional but Recommended)

Test your package locally before publishing:

```bash
npm link
```

Then in another project:
```bash
npm link @your-username/your-package-name
```

### 7. Publish to NPM

#### Option A: Using the Provided Script

The repository includes a comprehensive release script:

```bash
# Publish patch version (1.0.0 -> 1.0.1)
npm run release

# Publish minor version (1.0.0 -> 1.1.0)
npm run release:minor

# Publish major version (1.0.0 -> 2.0.0)
npm run release:major

# Dry run (no actual publishing)
npm run release:dry

# NPM only (skip MCP registry)
npm run release:alpha
```

The script will:
1. Bump the version
2. Build the project
3. Commit and tag the version
4. Publish to npm
5. (Optionally) Publish to MCP registry

#### Option B: Manual Publishing

If you prefer manual control:

```bash
# Bump version
npm version patch  # or minor, major

# Build
npm run build

# Publish
npm publish --access public
```

### 8. Configure GitHub Actions (Optional)

Update GitHub Actions workflows to use your repository:

1. Update workflow files in `.github/workflows/`
2. Replace repository references with your own
3. Configure any necessary secrets (e.g., `OPENAI_API_KEY` for LLM tests)

### 9. Set Up GitHub Repository Secrets

If you want to publish automatically via GitHub Actions:

1. Go to your repository Settings → Secrets and variables → Actions
2. Add `NPM_TOKEN`:
   - Generate a token at [npmjs.com/settings/tokens](https://www.npmjs.com/settings/your-username/tokens)
   - Create an "Automation" token with "Read and write" permission
   - Add it as a secret named `NPM_TOKEN`

### 10. Update Version Management

The project uses `scripts/sync-version.js` to keep versions in sync. Ensure it updates all relevant files:
- `package.json`
- `package-lock.json`
- Any other version-specific files

## Publishing Best Practices

### Semantic Versioning

Follow [Semantic Versioning](https://semver.org/):
- **Patch** (1.0.x): Bug fixes, no API changes
- **Minor** (1.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

### Pre-release Versions

For testing, use pre-release versions:

```bash
npm version prerelease --preid=alpha
npm publish --tag alpha
```

Users can install with:
```bash
npm install @your-username/your-package-name@alpha
```

### Changelogs

Maintain a `CHANGELOG.md` file documenting changes in each version:

```markdown
# Changelog

## [1.0.1] - 2024-01-15
### Fixed
- Bug fix description

## [1.0.0] - 2024-01-01
### Added
- Initial release based on @wonderwhy-er/desktop-commander
```

### Git Tags

The release script automatically creates git tags. Manually:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Maintaining Your Fork

### Syncing with Upstream

To get updates from the original repository:

```bash
# Add upstream remote (one time)
git remote add upstream https://github.com/wonderwhy-er/DesktopCommanderMCP.git

# Fetch upstream changes
git fetch upstream

# Merge upstream changes
git merge upstream/main
```

### Customization

You can customize the fork however you like:
- Add new features
- Modify existing functionality
- Change the UI/UX
- Add new tools

Just ensure you maintain the MIT license and proper attribution.

## Troubleshooting

### "Package name already taken"

If your package name is taken, try:
- Using a scoped package: `@your-username/package-name`
- Adding a prefix/suffix: `your-package-name-mcp`
- Choosing a different name

### "Permission denied" during publish

Ensure you're logged in to npm:
```bash
npm whoami  # Check if logged in
npm login   # Login if needed
```

### Build failures

If the build fails:
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### "Cannot find module" errors

Ensure all dependencies are installed:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Additional Resources

- [npm Publishing Guide](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [Semantic Versioning](https://semver.org/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [MCP Registry](https://github.com/modelcontextprotocol/registry)

## Support

For questions about the original Desktop Commander MCP:
- Original Repository: https://github.com/wonderwhy-er/DesktopCommanderMCP
- Original Issues: https://github.com/wonderwhy-er/DesktopCommanderMCP/issues

For questions about your fork:
- Create issues in your own repository
- Update README with your contact information
