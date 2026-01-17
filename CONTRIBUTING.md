# Contributing to AgentShield

Thank you for your interest in contributing to AgentShield! We welcome all contributions, whether they're bug fixes, new features, documentation improvements, or any other type of contribution.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- Node.js (v16 or later)
- npm (v8 or later) or Yarn (v1.22 or later)
- Git

### Development Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/agentshield.git
   cd agentshield
   ```
3. Install dependencies:
   ```bash
   npm install
   # or
   yarn
   ```
4. Create a new branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-number-description
   ```

## Development Workflow

1. Make your changes following the code style guidelines below
2. Add tests for your changes
3. Run the test suite:
   ```bash
   npm test
   # or
   yarn test
   ```
4. Ensure all tests pass
5. Commit your changes following the commit message guidelines
6. Push your branch to your fork
7. Open a Pull Request (PR) against the `main` branch

## Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Use camelCase for variables and functions
- Use PascalCase for classes and components
- Include JSDoc comments for all public functions and classes
- Follow the existing code style in the codebase

## Testing

- Write unit tests for all new features and bug fixes
- Ensure all tests pass before submitting a PR
- Update any existing tests if your changes affect their functionality
- For UI changes, include before/after screenshots if applicable

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. Please format your commit messages as follows:

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries

### Examples

```
feat: add user authentication

- Add JWT authentication
- Add login/logout functionality

Closes #123
```

```
fix: resolve memory leak in request handler

- Fix unclosed database connections
- Add proper cleanup in request handler

Fixes #456
```

## Pull Request Process

1. Ensure any install or build dependencies are removed before the end of the layer when doing a build
2. Update the README.md with details of changes to the interface, this includes new environment variables, exposed ports, useful file locations and container parameters
3. You may merge the PR once you have the sign-off of one other developer, or if you do not have permission to do that, you may request the reviewer to merge it for you

## License

By contributing, you agree that your contributions will be licensed under its [Apache License 2.0](LICENSE).