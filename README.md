# 🚀 GemCommit - AI-Powered Conventional Commit Generator

**GemCommit** is a VS Code extension that generates commit messages automatically using **Google Gemini AI**, following the **Conventional Commits** specification.

## ✨ Features

- 🔥 **AI-powered commit message generation** based on staged changes.
- 📝 **Follows Conventional Commits** (`feat`, `fix`, `docs`, `chore`, etc.).
- ⚡ **One-click commit message insertion** in the Source Control input.
- 🖊️ **Detailed commit messages** with body and breaking changes support.
- 📜 **Commit history tracking** for easy reuse of previous messages.
- 🌐 **Supports customization of AI model** in settings.
- 🎨 **Seamless integration with VS Code's Source Control UI.**

## 📸 Screenshots

![GemCommit in Action] <!-- (images/gemcommit-demo.gif) -->

## 📦 Requirements

- **VS Code** `^1.97.0`
- **Google Gemini AI API Key** (see [Setup](#-setup))

## ⚙️ Setup

1. Get a **Google Gemini API Key** from [Google AI Studio](https://aistudio.google.com/).
2. Create a file named `.env` in your home directory (`~/.env`).
3. Add the following line to the `~/.env` file, replacing `YOUR_API_KEY` with your actual key:

  ```bash
  #!/usr/bin/env bash

  export GEMINI_API_KEY="YOUR_API_KEY"
  ```

## 🔧 Extension Settings

| Setting                           | Description                                                                                         |
|-----------------------------------|-----------------------------------------------------------------------------------------------------|
| `gemcommit.apiKey`                | **[Deprecated]** API key for Google Gemini AI. Please use the `GEMINI_API_KEY` in `~/.env` instead. |
| `gemcommit.model`                 | AI model for generating commit messages.                                                            |
| `gemcommit.customPrompt`          | Custom prompt template for commit messages.                                                         |
| `gemcommit.promptBeforeInsert`    | Enables review before inserting commit messages.                                                    |
| `gemcommit.maxHistorySize`        | Maximum number of commit messages stored in history.                                                |
| `gemcommit.includeProjectContext` | Includes project details (e.g., package.json) in AI prompts.                                        |
| `gemcommit.commitLanguage`        | Language for commit messages (e.g., english, spanish).                                              |

## 🛠 Commands

| Command                                       | Description                                    |
| --------------------------------------------- | ---------------------------------------------- |
| `GemCommit: Generate Commit Message`          | Generates a Conventional Commit message.       |
| `GemCommit: Generate Detailed Commit Message` | Generates a detailed commit with body & scope. |
| `GemCommit: Show Commit History`              | Displays previous commit messages for reuse.   |

## 🛠 Known Issues

- No known issues. Feel free to report any [here](https://github.com/bernabedev/gemcommit/issues).

## 📌 Release Notes

### 1.0.8

- **Security**: The `gemcommit.apiKey` setting is now deprecated. The API key is now read from a `GEMINI_API_KEY` variable in the `~/.env` file to enhance security. A warning will be shown if the old setting is still in use.

### 1.0.7

- AI-powered commit message generation.
- VS Code Source Control integration.
- Conventional Commits support.
- Commit history tracking.
- Review before inserting commit messages.
- Support for multiple languages.

## 📜 Following Extension Guidelines

Make sure to follow the official [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines) for best practices.

## 🎯 Contribution

Contributions are welcome! Fork the repo and submit a PR [here](https://github.com/bernabedev/gemcommit).

---

🔗 **More Information:**

- [VS Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)