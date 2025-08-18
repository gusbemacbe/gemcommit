import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import * as path from "path";
import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import * as dotenv from "dotenv";
import { homedir } from "os";

// Interface for storing configurations
interface CommitConfiguration {
  type: string;
  scope?: string;
  description: string;
  body?: string;
  breakingChanges?: boolean;
}

/**
 * Retrieves the API key, prioritizing the environment file over deprecated settings.
 * @returns The API key, or null if not found.
 */
export async function getApiKey(): Promise<string | null> {
  // 1. Checking the environment file first
  const homeUri = vscode.Uri.file(homedir());
  const envUri = vscode.Uri.joinPath(homeUri, ".env");
  try {
    const rawContent = await vscode.workspace.fs.readFile(envUri);
    const envConfig = dotenv.parse(Buffer.from(rawContent));
    if (envConfig.GEMINI_API_KEY) {
      return envConfig.GEMINI_API_KEY;
    }
  } catch (error) {
    // File does not exist or other read error, proceed to check settings
  }

  // 2. Checking the deprecated setting for the backward compatibility
  const config = vscode.workspace.getConfiguration("gemcommit");
  const apiKeyFromSettings = config.get<string>("apiKey");

  if (apiKeyFromSettings?.trim()) {
    vscode.window.showWarningMessage(
      l10n.t("deprecation.warning.apiKey")
    );
    return apiKeyFromSettings;
  }

  return null;
}

/**
 * Activates the extension
 * @param context - The VS Code extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // This is a robust way to avoid bundling and file system access issues.
  // It dynamically constructs the path to the correct language bundle.
  try {
    const userLanguage = vscode.env.language;
    let bundleUri = vscode.Uri.joinPath(context.extensionUri, 'l10n', `bundle.l10n.${userLanguage}.json`);
    
    // Check if the language-specific bundle exists
    try {
      await vscode.workspace.fs.stat(bundleUri);
    } catch (error) {
      // If it doesn't exist, fall back to the default English bundle
      bundleUri = vscode.Uri.joinPath(context.extensionUri, 'l10n', 'bundle.l10n.json');
    }

    const bundleContent = await vscode.workspace.fs.readFile(bundleUri);
    l10n.config({ contents: JSON.parse(new TextDecoder().decode(bundleContent)) });
  } catch (error) {
    // If any bundle fails to load, log it and continue without translations.
    console.error("Failed to load l10n bundle", error);
  }

  // Register the main command
  let disposable = vscode.commands.registerCommand(
    "gemcommit.suggestCommitMessage",
    async () => {
      try {
        const apiKey = await getApiKey();

        if (!apiKey) {
          vscode.window.showErrorMessage(l10n.t("error.no.api.key"));
          return;
        }

        const repository = await getGitRepository();
        if (!repository) {
          return;
        }

        // Showing the progress indicator
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t("generating.commit.message"),
            cancellable: false,
          },
          async () => {
            const genAI = new GoogleGenerativeAI(apiKey);
            const stagedDiff = await (repository as any).diff(true);

            if (!stagedDiff.trim()) {
              vscode.window.showInformationMessage(l10n.t("no.staged.changes"));
              return;
            }

            // Add additional project context
            const projectContext = await getProjectContext();
            const config = vscode.workspace.getConfiguration("gemcommit");
            
            const customPromptFromFile = await readCustomPromptFile(false); // Not detailed
            let commitMessage: string;

            if (customPromptFromFile) {
                commitMessage = await generateMessageFromCustomFile(
                    genAI,
                    stagedDiff,
                    projectContext,
                    customPromptFromFile
                );
            } else {
                commitMessage = await generateCommitMessage(
                    genAI,
                    stagedDiff,
                    projectContext
                );
            }

            // Allow editing before inserting
            const shouldEdit =
              config.get<boolean>("promptBeforeInsert") ?? false;
            if (shouldEdit) {
              const editedMessage = await vscode.window.showInputBox({
                prompt: l10n.t("prompt.review.commit.message"),
                value: commitMessage,
                placeHolder: l10n.t("placeholder.review.commit.message"),
              });

              if (editedMessage) {
                repository.inputBox.value = editedMessage.trim();
              }
            } else {
              repository.inputBox.value = commitMessage.trim();
            }

            // Save to history
            saveToCommitHistory(commitMessage, context);

            vscode.window.showInformationMessage(
              l10n.t("commit.message.generated")
            );
          }
        );
      } catch (error: unknown) {
        vscode.window.showErrorMessage(
          l10n.t("error.generating.commit.message", 
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
  );

  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gemcommit.insertCommitMessage",
      async () => {
        vscode.commands.executeCommand("gemcommit.suggestCommitMessage");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gemcommit.detailedCommitMessage",
      async () => {
        try {
          const apiKey = await getApiKey();

          if (!apiKey) {
            vscode.window.showErrorMessage(l10n.t("error.no.api.key"));
            return;
          }

        const repository = await getGitRepository();
        if (!repository) {
            return;
          }

          // **IMPROVEMENT: Wrapping the entire async operation in a progress indicator**
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: l10n.t("generating.detailed.commit.message"),
              cancellable: false,
            },
            async () => {
              const stagedDiff = await (repository as any).diff(true);

              if (!stagedDiff.trim()) {
                // We need to show the message outside the progress indicator
                vscode.window.showInformationMessage(l10n.t("no.staged.changes"));
                return;
              }

              const genAI = new GoogleGenerativeAI(apiKey);
              const projectContext = await getProjectContext();
              
              const customPromptFromFile = await readCustomPromptFile(true); // Is detailed
              let commitConfig: CommitConfiguration;

              if (customPromptFromFile) {
                  commitConfig = await generateDetailedMessageFromCustomFile(
                      genAI,
                      stagedDiff,
                      projectContext,
                      customPromptFromFile
                  );
              } else {
                  commitConfig = await generateDetailedCommit(
                      genAI,
                      stagedDiff,
                      projectContext
                  );
              }

              const commitMessage = await showCommitEditor(commitConfig);
              if (commitMessage) {
                repository.inputBox.value = commitMessage;
              }
            }
          );
        } catch (error: unknown) {
          console.error("Error generating detailed commit message:", error);
          vscode.window.showErrorMessage(
            l10n.t("error.generating.commit.message", 
              error instanceof Error ? error.message : String(error)
            )
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gemcommit.showCommitHistory", async () => {
      showCommitHistory(context);
    })
  );

  vscode.commands.executeCommand("setContext", "scmProvider", "git");
}

/**
 * A helper function to get the active Git repository.
 * It shows error messages if the Git extension or a repository is not found.
 * @returns The repository object or null if not found.
 */
async function getGitRepository(): Promise<any | null> {
	const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
	if (!gitExtension) {
		vscode.window.showErrorMessage(l10n.t("git.extension.not.found"));
		return null;
	}

	const gitAPI = gitExtension.getAPI(1);
	const repository = gitAPI.repositories[0];

	if (!repository) {
		vscode.window.showErrorMessage(l10n.t("no.git.repository"));
		return null;
	}

	return repository;
}

/**
 * Gets additional project context
 */
export async function getProjectContext(): Promise<string> {
  try {
    const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!rootUri) {
      return "";
    }

    let projectInfo = "";
    const packageJsonUri = vscode.Uri.joinPath(rootUri, "package.json");

    try {
      const rawContent = await vscode.workspace.fs.readFile(packageJsonUri);
      const packageJson = JSON.parse(new TextDecoder().decode(rawContent));
      projectInfo += `Project name: ${packageJson.name}\n`;
      projectInfo += `Description: ${
        packageJson.description || "Not available"
      }\n`;
      projectInfo += `Dependencies: ${Object.keys(
        packageJson.dependencies || {}
      ).join(", ")}\n`;
    } catch (error) {
      // package.json doesn't exist or is invalid, which is fine.
    }

    // Get the last commit
    const repository = await getGitRepository();
    if (repository) {
      const lastCommit = await (repository as any).log({ maxEntries: 1 });
      if (lastCommit?.length > 0) {
        projectInfo += `Last commit: ${lastCommit[0].message}\n`;
      }
    }

    return projectInfo;
  } catch (error) {
    console.error("Error getting project context:", error);
    return "";
  }
}

/**
 * Reads the custom prompt file from the workspace root.
 * @param isDetailed - Determines whether to read the detailed or simple prompt file.
 * @returns The content of the file, or null if it doesn't exist.
 */
async function readCustomPromptFile(isDetailed: boolean): Promise<string | null> {
    const config = vscode.workspace.getConfiguration("gemcommit");
    const settingKey = isDetailed ? "customDetailedPromptFile" : "customPromptFile";
    const defaultFileName = isDetailed ? ".gemcommit_detailed.md" : ".gemcommit.md";
    const fileName = config.get<string>(settingKey) || defaultFileName;

    const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!rootUri) {
        return null;
    }

    const promptFileUri = vscode.Uri.joinPath(rootUri, fileName);

    try {
        const rawContent = await vscode.workspace.fs.readFile(promptFileUri);
        return new TextDecoder().decode(rawContent);
    } catch (error) {
        // File not found, which is a normal case.
        return null;
    }
}

/**
 * Generates a commit message using a prompt from a custom Markdown file.
 */
async function generateMessageFromCustomFile(
  genAI: GoogleGenerativeAI,
  stagedDiff: string,
  projectContext: string,
  customPromptFromFile: string
): Promise<string> {
    const config = vscode.workspace.getConfiguration("gemcommit");

    // Replicating the logic to append context and diff
    const prompt = `${customPromptFromFile}
  
    ${projectContext ? `\n\nProject context:\n${projectContext}` : ""}
    
    Here is the git diff:
    
    ${stagedDiff}`;

    const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
    const modelName = config.get<string>("model") ?? "gemini-2.5-flash";

    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const { response } = await model.generateContent({ contents });
        return response.text();
    } catch (error) {
        console.error("Gemini AI Error:", error);
        throw error;
    }
}

/**
 * Generates a detailed commit message using a prompt from a custom Markdown file.
 */
async function generateDetailedMessageFromCustomFile(
  genAI: GoogleGenerativeAI,
  stagedDiff: string,
  projectContext: string,
  customPromptFromFile: string
): Promise<CommitConfiguration> {
    const config = vscode.workspace.getConfiguration("gemcommit");
    const language = config.get<string>("commitLanguage") ?? "english";
    const languageInstruction = `The 'description' and 'body' fields in the JSON output MUST be written in ${language}.`;

    const prompt = `${customPromptFromFile}
    
    ${languageInstruction}
  
    Return the result in JSON format with the following properties:
    {
      "type": "feat|fix|refactor|docs|style|test|...",
      "scope": "optional scope",
      "description": "short description",
      "body": "detailed explanation",
      "breakingChanges": boolean
    }
    
    IMPORTANT: Return ONLY the raw JSON without any Markdown formatting, code blocks, backticks, or explanation text. The response should start with '{' and end with '}'.
    
    ${projectContext ? `\n\nProject context:\n${projectContext}` : ""}
    
    Here is the git diff:
    
    ${stagedDiff}`;

    const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
    const modelName = config.get<string>("model") ?? "gemini-2.5-flash";

    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const { response } = await model.generateContent({ contents });
        const responseText = response.text();

        let jsonText = responseText;

        if (responseText.includes("```")) {
            const match = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match && match[1]) {
                jsonText = match[1].trim();
            }
        }

        const startIndex = jsonText.indexOf("{");
        const endIndex = jsonText.lastIndexOf("}") + 1;

        if (startIndex !== -1 && endIndex > startIndex) {
            jsonText = jsonText.substring(startIndex, endIndex);
        }

        try {
            return JSON.parse(jsonText) as CommitConfiguration;
        } catch (parseError) {
            console.error("JSON parse error:", parseError);
            console.error("Attempted to parse:", jsonText);

            return {
                type: l10n.t("fallback.type"),
                description: l10n.t("fallback.description"),
                body: l10n.t("fallback.body", stagedDiff.split("\n").filter(line => line.startsWith("diff --git")).join(", ")),
                breakingChanges: false,
            };
        }
    } catch (error) {
        console.error("Gemini AI Error:", error);
        throw error;
    }
}

/**
 * Generates a commit message using Gemini AI with additional context
 */
export async function generateCommitMessage(
  genAI: GoogleGenerativeAI,
  stagedDiff: string,
  projectContext: string
): Promise<string> {
  const config = vscode.workspace.getConfiguration("gemcommit");
  const customPrompt = config.get<string>("customPrompt") || "";

  const language = config.get<string>("commitLanguage") ?? "english";
  const languageInstruction = `Generate the commit message content (description, body if applicable) in ${language}.`;

  const prompt = `${
    customPrompt ||
    `Analyze the following git diff and generate a Conventional Commit message that accurately describes the changes made.
  - The message must be concise and informative, following the Conventional Commits format.
  - ${languageInstruction}
  - The commit message should not exceed 150 characters in the subject line.
  - Use imperative mood (e.g., "fix bug" instead of "fixed bug").
  - Include a scope if relevant (e.g., "feat(auth): add login validation").
  - If the commit fixes a bug, use "fix".
  - If the commit introduces a new feature, use "feat".
  - If the commit includes refactoring, use "refactor".
  - If the commit adds tests, use "test".
  - If the commit updates documentation, use "docs".
  - Do not include unnecessary details; keep it clear and to the point.
  - Return ONLY the commit message text, without formatting, backticks, or extra characters.`
  }
  
  ${projectContext ? `\n\nProject context:\n${projectContext}` : ""}
  
  Here is the git diff:
  
  ${stagedDiff}`;

  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  const modelName = config.get<string>("model") ?? "gemini-2.5-flash";

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const { response } = await model.generateContent({ contents });
    return response.text();
  } catch (error) {
    console.error("Gemini AI Error:", error);
    throw error;
  }
}

/**
 * Generates a detailed commit with title, body, and breaking changes
 */
export async function generateDetailedCommit(
  genAI: GoogleGenerativeAI,
  stagedDiff: string,
  projectContext: string
): Promise<CommitConfiguration> {
  const config = vscode.workspace.getConfiguration("gemcommit");
  const language = config.get<string>("commitLanguage") ?? "english";
  const languageInstruction = `The 'description' and 'body' fields in the JSON output MUST be written in ${language}.`;

  const prompt = `Analyze the following git diff and generate a detailed Conventional Commit message with the following parts:
  1. Type (e.g., feat, fix, refactor, docs, style, test, etc.)
  2. Scope (optional, in parentheses)
  3. Short description
  4. Detailed body explaining the changes
  5. Note any breaking changes

  ${languageInstruction}
  
  Return the result in JSON format with the following properties:
  {
    "type": "feat|fix|refactor|docs|style|test|...",
    "scope": "optional scope",
    "description": "short description",
    "body": "detailed explanation",
    "breakingChanges": boolean
  }
  
  IMPORTANT: Return ONLY the raw JSON without any Markdown formatting, code blocks, backticks, or explanation text. The response should start with '{' and end with '}'.
  
  ${projectContext ? `\n\nProject context:\n${projectContext}` : ""}
  
  Here is the git diff:
  
  ${stagedDiff}`;

  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  const modelName = config.get<string>("model") ?? "gemini-2.5-flash";

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const { response } = await model.generateContent({ contents });
    const responseText = response.text();

    let jsonText = responseText;

    if (responseText.includes("```")) {
      const match = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonText = match[1].trim();
      }
    }

    // Get JSON object
    const startIndex = jsonText.indexOf("{");
    const endIndex = jsonText.lastIndexOf("}") + 1;

    if (startIndex !== -1 && endIndex > startIndex) {
      jsonText = jsonText.substring(startIndex, endIndex);
    }

    try {
      return JSON.parse(jsonText) as CommitConfiguration;
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Attempted to parse:", jsonText);

      // Return a default commit if parsing fails
      return {
        type: l10n.t("fallback.type"),
        description: l10n.t("fallback.description"),
        body:
          l10n.t("fallback.body", stagedDiff
            .split("\n")
            .filter((line) => line.startsWith("diff --git"))
            .join(", ")),
        breakingChanges: false,
      };
    }
  } catch (error) {
    console.error("Gemini AI Error:", error);
    throw error;
  }
}

/**
 * Displays an editor to modify the detailed commit
 */
export async function showCommitEditor(
  commitConfig: CommitConfiguration
): Promise<string | undefined> {
  try {
    if (!commitConfig.type || !commitConfig.description) {
      console.error("Invalid commit config received:", commitConfig);
      vscode.window.showErrorMessage(
        l10n.t("error.invalid.ai.response")
      );

      commitConfig = {
        type: commitConfig.type || l10n.t("fallback.type"),
        scope: commitConfig.scope,
        description: commitConfig.description || l10n.t("fallback.description"),
        body: commitConfig.body || "",
        breakingChanges: !!commitConfig.breakingChanges,
      };
    }

    // Create a new webview panel
    const panel = vscode.window.createWebviewPanel(
      "gemcommitEditor",
      l10n.t("webview.title"),
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    // Escape values to prevent HTML issues
    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    panel.webview.html = `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${l10n.t("webview.title")}</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            max-width: 600px;
          }
          label {
            color: var(--vscode-foreground);
            margin-bottom: 5px;
            display: block;
          }
          input, textarea {
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
          }
          button {
            padding: 10px 20px;
            cursor: pointer;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            transition: background-color 0.3s;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 15px;
            border-radius: 4px;
            white-space: pre-wrap;
          }
          .flex-row {
            display: flex;
            gap: 10px;
          }
          .flex-row > div {
            flex: 1;
          }
        </style>
      </head>
      <body>
        <h2>${l10n.t("webview.header")}</h2>
        <form id="commitForm">
          <div class="flex-row">
            <div>
              <label for="type">${l10n.t("webview.type.label")}</label>
              <input type="text" id="type" value="${escapeHtml(
                commitConfig.type
              )}" required>
            </div>
            <div>
              <label for="scope">${l10n.t("webview.scope.label")}</label>
              <input type="text" id="scope" value="${escapeHtml(
                commitConfig.scope || ""
              )}">
            </div>
          </div>
      
          <label for="description">${l10n.t("webview.description.label")}</label>
          <input type="text" id="description" value="${escapeHtml(
            commitConfig.description
          )}" required>
      
          <label for="body">${l10n.t("webview.body.label")}</label>
          <textarea id="body" rows="5">${escapeHtml(
            commitConfig.body || ""
          )}</textarea>
      
          <div style="display: flex; align-items: center;">
            <input type="checkbox" id="breaking" ${
              commitConfig.breakingChanges ? "checked" : ""
            } style="width: 20px;margin-bottom: 0;">
            <label for="breaking" style="display: inline;margin-bottom: 0;">${l10n.t("webview.breaking.label")}</label>
          </div>
      
          <h3>${l10n.t("webview.preview.header")}</h3>
          <pre id="preview"></pre>
      
          <div>
            <button type="submit">${l10n.t("webview.apply.button")}</button>
            <button type="button" id="cancelBtn">${l10n.t("webview.cancel.button")}</button>
          </div>
        </form>
      
        <script>
          const typeInput = document.getElementById('type');
          const scopeInput = document.getElementById('scope');
          const descriptionInput = document.getElementById('description');
          const bodyInput = document.getElementById('body');
          const breakingInput = document.getElementById('breaking');
          const previewElement = document.getElementById('preview');
      
          function updatePreview() {
            const type = typeInput.value;
            const scope = scopeInput.value ? \`(\${scopeInput.value})\` : '';
            const breaking = breakingInput.checked ? '!' : '';
            const description = descriptionInput.value;
            const body = bodyInput.value;
      
            let preview = \`\${type}\${scope}\${breaking}: \${description}\`;
            if (body) {
              preview += \`\n\n\${body}\`;
            }
      
            if (breakingInput.checked && !body.toLowerCase().includes('breaking change')) {
              preview += \`\n\nBREAKING CHANGE: This commit introduces breaking changes.\`;
            }
      
            previewElement.textContent = preview;
          }
      
          [typeInput, scopeInput, descriptionInput, bodyInput, breakingInput].forEach(input => {
            input.addEventListener('input', updatePreview);
          });
      
          updatePreview();
      
          document.getElementById('commitForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const vscode = acquireVsCodeApi();
            vscode.postMessage({
              command: 'applyCommit',
              commitMessage: previewElement.textContent
            });
          });
      
          document.getElementById('cancelBtn').addEventListener('click', () => {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({
              command: 'cancel'
            });
          });
        </script>
      </body>
      </html>
      `;

    return new Promise((resolve) => {
      panel.webview.onDidReceiveMessage(
        (message) => {
          if (message.command === "applyCommit") {
            resolve(message.commitMessage);
            panel.dispose();
          } else if (message.command === "cancel") {
            resolve(undefined);
            panel.dispose();
          }
        },
        undefined,
        []
      );
    });
  } catch (error) {
    console.error("Error displaying commit editor:", error);
    vscode.window.showErrorMessage(
      l10n.t("error.displaying.commit.editor", error instanceof Error ? error.message : String(error))
    );
    return undefined;
  }
}

/**
 * Saves a generated commit to the history
 */
export function saveToCommitHistory(
  commitMessage: string,
  context: vscode.ExtensionContext
): void {
  try {
    const history = context.globalState.get<string[]>("commitHistory", []);

    const updatedHistory = [commitMessage, ...history.slice(0, 19)]; // Keep the last 20

    context.globalState.update("commitHistory", updatedHistory);
  } catch (error) {
    console.error("Error saving to commit history:", error);
  }
}

/**
 * Displays the history of generated commits
 */
export async function showCommitHistory(
  context: vscode.ExtensionContext
): Promise<void> {
  const history = context.globalState.get<string[]>("commitHistory", []);

  if (history.length === 0) {
    vscode.window.showInformationMessage(l10n.t("info.no.commit.history"));
    return;
  }

  const selectedCommit = await vscode.window.showQuickPick(history, {
    placeHolder: l10n.t("placeholder.reuse.commit.message"),
  });

  if (selectedCommit) {
    const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    if (gitExtension) {
      const gitAPI = gitExtension.getAPI(1);
      const repository = gitAPI.repositories[0];
      if (repository) {
        repository.inputBox.value = selectedCommit;
        vscode.window.showInformationMessage(
          l10n.t("info.commit.message.reused")
        );
      }
    }
  }
}

export function deactivate(): void {}