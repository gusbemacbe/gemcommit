import * as assert from "assert";
import * as vscode from "vscode";
const fs = require("fs");

import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import { activate, generateCommitMessage, generateDetailedCommit, getApiKey, getProjectContext, saveToCommitHistory } from "../extension";

suite("GemCommit Extension Test Suite", () => {
  vscode.window.showInformationMessage("Starting all tests.");

  let sandbox: sinon.SinonSandbox;

  // Creating the sandbox before each test suite
  setup(() => {
    sandbox = sinon.createSandbox();
  });

  // Restoring the sandbox after each test suite to remove all stubs
  teardown(() => {
    sandbox.restore();
  });

  suite("API Key Retrieval", () => {
    test("Should retrieve API key from `~/.env` file", () => {
      const envPath = path.join(os.homedir(), ".env");
      const fakeEnvContent = "GEMINI_API_KEY=key_from_env_file";

      // Stubbing the `fs` methods
      sandbox.stub(fs, "existsSync").withArgs(envPath).returns(true);
      sandbox.stub(fs, "readFileSync").withArgs(envPath).returns(fakeEnvContent);

      const apiKey = getApiKey();
      assert.strictEqual(
        apiKey,
        "key_from_env_file",
        "API key should be read from `.env` file"
      );
    });

    test("Should retrieve API key from deprecated settings if `.env` is not found", () => {
      // Stubbing `getConfiguration` to return a mock object
      const workspaceConfigStub = {
        get: (key: string) => {
          if (key === "apiKey") {
            return "key_from_settings";
          }
          return undefined;
        },
      };
      sandbox.stub(vscode.workspace, "getConfiguration").withArgs("gemcommit").returns(workspaceConfigStub as any);

      // Stubbing `fs` to report that `.env` does not exist
      sandbox.stub(fs, "existsSync").returns(false);

      const apiKey = getApiKey();
      assert.strictEqual(
        apiKey,
        "key_from_settings",
        "API key should be read from settings as a fallback"
      );
    });

    test("Should prioritize the API key from `~/.env` file when both exist", () => {
      const envPath = path.join(os.homedir(), ".env");
      const fakeEnvContent = "GEMINI_API_KEY=key_from_env_file_priority";

      // Stubbing both sources
      sandbox.stub(fs, "existsSync").withArgs(envPath).returns(true);
      sandbox.stub(fs, "readFileSync").withArgs(envPath).returns(fakeEnvContent);

      const workspaceConfigStub = {
        get: (key: string) => "key_from_settings_ignored",
      };

      sandbox.stub(vscode.workspace, "getConfiguration").returns(workspaceConfigStub as any);

      const apiKey = getApiKey();
      assert.strictEqual(
        apiKey,
        "key_from_env_file_priority",
        "`.env` file key should take precedence"
      );
    });

    test("Should return null when no API key is found", () => {
      // The stubs will return the default "falsy" values, so no key will be found
      sandbox.stub(fs, "existsSync").returns(false);
      
      const workspaceConfigStub = {
        get: (key: string) => "",
      };

      sandbox.stub(vscode.workspace, "getConfiguration").returns(workspaceConfigStub as any);

      const apiKey = getApiKey();
      assert.strictEqual(
        apiKey,
        null,
        "Should return null if no key is found in any source"
      );
    });

    test("Should return null if `GEMINI_API_KEY` is not in the `.env` file", () => {
      const envPath = path.join(os.homedir(), ".env");

      // Stubbing `fs` to find the `.env` file but with no relevant key
      sandbox.stub(fs, "existsSync").withArgs(envPath).returns(true);
      sandbox.stub(fs, "readFileSync").withArgs(envPath).returns("OTHER_VAR=some_value");

      const apiKey = getApiKey();
      assert.strictEqual(
        apiKey,
        null,
        "Should return null if the key is not in the `.env` file"
      );
    });
  });

  suite("Extension Activation", () => {
    test("Should register all commands and set context on activation", () => {
      // Creating a spy on `registerCommand` to track its calls
      const registerCommandSpy = sandbox.spy(vscode.commands, "registerCommand");
      const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");

      // Creating a mock `Memento` that satisfies the base interface
      const createMockMemento = (): vscode.Memento => {
        const store: { [key: string]: any } = {};
        return {
          keys: () => Object.keys(store),
          get: <T>(key: string, defaultValue?: T): T | undefined => store[key] || defaultValue,
          update: (key: string, value: any): Promise<void> => {
            store[key] = value;
            return Promise.resolve();
          },
        };
      };

      // Creating a specific mock for `globalState` that includes `setKeysForSync`
      const mockGlobalState = {
        ...createMockMemento(),
        setKeysForSync: (keys: readonly string[]): void => {
          // This is a no-op for our test purposes
        },
      };
      
      // Creating a mock `Uri` to satisfy the type checker
      const mockUri = vscode.Uri.parse("file:///mock/path");

      // Creating a mock `ExtensionContext`
      const mockContext: vscode.ExtensionContext = {
        subscriptions: [],
        workspaceState: createMockMemento(),
        globalState: mockGlobalState,
        extensionPath: "",
        storagePath: "",
        logPath: "",
        globalStoragePath: "",
        asAbsolutePath: (relativePath: string) => relativePath,
        storageUri: mockUri,
        globalStorageUri: mockUri,
        logUri: mockUri,
        extensionUri: mockUri,
        environmentVariableCollection: undefined as any,
        extensionMode: vscode.ExtensionMode.Test,
        
        // Adding the newly required properties with the minimal mock implementations
        secrets: {
          get: async (key: string) => undefined,
          store: async (key: string, value: string) => {},
          delete: async (key: string) => {},
          onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
        },
        extension: {
          id: 'mock.extension',
          extensionUri: mockUri,
          extensionPath: '',
          isActive: true,
          packageJSON: {},
          extensionKind: vscode.ExtensionKind.UI,
          exports: {},
          activate: () => Promise.resolve({}),
        },
        languageModelAccessInformation: <any>{ // The cast to any to bypass the strict type checking for testing
            getProviderInfos: async () => [], // This property is causing the error
            onDidChange: new vscode.EventEmitter<void>().event,
        }
      };

      // Activating the extension
      activate(mockContext);

      // Asserting that all commands were registered
      assert.strictEqual(registerCommandSpy.callCount, 4, "Should register exactly four commands");
      assert.ok(registerCommandSpy.calledWith("gemcommit.suggestCommitMessage"));
      assert.ok(registerCommandSpy.calledWith("gemcommit.insertCommitMessage"));
      assert.ok(registerCommandSpy.calledWith("gemcommit.detailedCommitMessage"));
      assert.ok(registerCommandSpy.calledWith("gemcommit.showCommitHistory"));

      // Asserting that the context was set for the SCM view
      assert.ok(
        executeCommandStub.calledWith("setContext", "scmProvider", "git"),
        "Should set the SCM provider context"
      );

      // Asserting that the command disposables were pushed to subscriptions
      assert.strictEqual(
        mockContext.subscriptions.length,
        4,
        "Four disposables should be added to subscriptions"
      );
    });
  });

  suite("Project Context Retrieval", () => {
    test("Should return an empty string if no workspace folder is open", async () => {
      // Stubbing `workspaceFolders` to be undefined
      sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);

      const context = await getProjectContext();
      assert.strictEqual(context, "", "Context should be empty when no workspace is open");
    });

    test("Should correctly read project info from `package.json`", async () => {
      // Mocking the workspace and `package.json`
      const mockWorkspaceFolder = { uri: { fsPath: "/mock/project" } };
      sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

      const packageJsonPath = path.join(mockWorkspaceFolder.uri.fsPath, "package.json");
      const fakePackageJson = JSON.stringify({
        name: "test-project",
        description: "A test project description.",
        dependencies: { "some-dep": "1.0.0" },
      });

      sandbox.stub(fs, "existsSync").withArgs(packageJsonPath).returns(true);
      sandbox.stub(fs, "readFileSync").withArgs(packageJsonPath, "utf8").returns(fakePackageJson);

      // Stubbing the Git API to return no last commit
      sandbox.stub(vscode.extensions, "getExtension").returns({
        exports: { getAPI: () => ({ repositories: [{ log: async () => [] }] }) },
      } as any);

      const context = await getProjectContext();
      assert.ok(context.includes("Project name: test-project"));
      assert.ok(context.includes("Description: A test project description."));
      assert.ok(context.includes("Dependencies: some-dep"));
    });

    test("Should correctly retrieve the last commit message", async () => {
      // Mocking a workspace but no package.json
      const mockWorkspaceFolder = { uri: { fsPath: "/mock/project" } };
      sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);
      sandbox.stub(fs, "existsSync").returns(false);

      // Mocking the Git API to return a last commit
      const mockLog = [{ message: "feat: implement the main feature" }];
      const mockGitApi = {
        getAPI: () => ({
          repositories: [{ log: async () => mockLog }],
        }),
      };
      sandbox.stub(vscode.extensions, "getExtension").withArgs("vscode.git").returns({ exports: mockGitApi } as any);

      const context = await getProjectContext();
      assert.ok(context.includes("Last commit: feat: implement the main feature"));
    });

    test("Should return a combined context from `package.json` and `git log`", async () => {
      // Mocking everything
      const mockWorkspaceFolder = { uri: { fsPath: "/mock/project" } };
      sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

      const packageJsonPath = path.join(mockWorkspaceFolder.uri.fsPath, "package.json");
      const fakePackageJson = JSON.stringify({ name: "full-project" });
      sandbox.stub(fs, "existsSync").withArgs(packageJsonPath).returns(true);
      sandbox.stub(fs, "readFileSync").withArgs(packageJsonPath, "utf8").returns(fakePackageJson);

      const mockLog = [{ message: "docs: update README" }];
      const mockGitApi = { getAPI: () => ({ repositories: [{ log: async () => mockLog }] }) };
      sandbox.stub(vscode.extensions, "getExtension").withArgs("vscode.git").returns({ exports: mockGitApi } as any);

      const context = await getProjectContext();
      assert.ok(context.includes("Project name: full-project"));
      assert.ok(context.includes("Last commit: docs: update README"));
    });

    test("Should handle the errors gracefully and return an empty string", async () => {
      // Mocking a scenario where `readFileSync` throws an error
      const mockWorkspaceFolder = { uri: { fsPath: "/mock/project" } };
      sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);
      sandbox.stub(fs, "existsSync").returns(true);
      sandbox.stub(fs, "readFileSync").throws(new Error("File read error"));

      const context = await getProjectContext();
      assert.strictEqual(context, "", "Context should be empty on error");
    });
  });

  suite("Commit Message Generation", () => {

    test("Should construct the correct prompt with default settings", async () => {
      // Stubbing `getConfiguration` to return default values
      const workspaceConfigStub = {
        get: (key: string) => {
          if (key === "customPrompt") { return ""; }
          if (key === "commitLanguage") { return "english"; }
          if (key === "model") { return "gemini-2.0-flash"; }
          return undefined;
        },
      };

      sandbox.stub(vscode.workspace, "getConfiguration").withArgs("gemcommit").returns(workspaceConfigStub as any);

      // Creating a mock `genAI` object with a spy on `generateContent`
      const mockResponse = { response: { text: () => "feat: test commit" } };
      const generateContentStub = sandbox.stub().resolves(mockResponse);
      const mockGenAI = {
        getGenerativeModel: sandbox.stub().returns({
          generateContent: generateContentStub,
        }),
      };

      const stagedDiff = "diff --git a/file.txt b/file.txt";
      const projectContext = "Project name: test-project";

      await generateCommitMessage(mockGenAI as any, stagedDiff, projectContext);

      // Asserting that `generateContent` was called
      assert.ok(generateContentStub.calledOnce, "`generateContent` should be called once");

      // Getting the actual prompt that was passed
      const actualPrompt = generateContentStub.firstCall.args[0].contents[0].parts[0].text;
      
      // --- DEBUGGING STEP ---
      // This will print the actual prompt to the debug console
      console.log("--- ACTUAL PROMPT ---");
      console.log(actualPrompt);
      console.log("--- END OF PROMPT ---");

      // Asserting the prompt contains all the necessary parts
      assert.ok(actualPrompt.includes("Analyze the following git diff"), "Prompt should contain the correct analysis instruction.");
      assert.ok(actualPrompt.includes("Generate the commit message content (description, body if applicable) in english."));
      assert.ok(actualPrompt.includes("Project name: test-project"));
      assert.ok(actualPrompt.includes("diff --git a/file.txt b/file.txt"));
    });

    test("Should use the custom prompt when it is provided", async () => {
      // Stubbing `getConfiguration` to return a custom prompt
      const workspaceConfigStub = {
        get: (key: string) => {
          if (key === "customPrompt") { return "My custom prompt template."; }
          if (key === "commitLanguage") { return "english"; }
          return undefined;
        },
      };

      sandbox.stub(vscode.workspace, "getConfiguration").withArgs("gemcommit").returns(workspaceConfigStub as any);

      const generateContentStub = sandbox.stub().resolves({ response: { text: () => "" } });

      const mockGenAI = {
        getGenerativeModel: sandbox.stub().returns({
          generateContent: generateContentStub,
        }),
      };

      await generateCommitMessage(mockGenAI as any, "diff", "context");

      const actualPrompt = generateContentStub.firstCall.args[0].contents[0].parts[0].text;

      assert.ok(actualPrompt.startsWith("My custom prompt template."));
    });

    test("Should include the correct language instruction in the prompt", async () => {
      // Stubbing `getConfiguration` to return a different language
      const workspaceConfigStub = {
        get: (key: string) => {
          if (key === "customPrompt") { return ""; }
          if (key === "commitLanguage") { return "spanish"; }
          return undefined;
        },
      };

      sandbox.stub(vscode.workspace, "getConfiguration").withArgs("gemcommit").returns(workspaceConfigStub as any);

      const generateContentStub = sandbox.stub().resolves({ response: { text: () => "" } });
      const mockGenAI = {
        getGenerativeModel: sandbox.stub().returns({
          generateContent: generateContentStub,
        }),
      };

      await generateCommitMessage(mockGenAI as any, "diff", "context");

      const actualPrompt = generateContentStub.firstCall.args[0].contents[0].parts[0].text;

      assert.ok(actualPrompt.includes("Generate the commit message content (description, body if applicable) in spanish."));
    });
  });

  suite("Detailed Commit Message Generation", () => {
    test("Should correctly parse a clean JSON response from the AI", async () => {
      // Mocking a perfect JSON response
      const cleanJsonResponse = `{
        "type": "feat",
        "scope": "api",
        "description": "implement new endpoint",
        "body": "Adds the new /users endpoint.",
        "breakingChanges": false
      }`;

      const mockResponse = { response: { text: () => cleanJsonResponse } };
      const generateContentStub = sandbox.stub().resolves(mockResponse);

      const mockGenAI = {
        getGenerativeModel: sandbox.stub().returns({
          generateContent: generateContentStub,
        }),
      };

      const result = await generateDetailedCommit(mockGenAI as any, "diff", "context");

      assert.deepStrictEqual(result, {
        type: "feat",
        scope: "api",
        description: "implement new endpoint",
        body: "Adds the new /users endpoint.",
        breakingChanges: false,
      });
    });

    test("Should correctly extract and parse JSON from a markdown code block", async () => {
      // Mocking a response wrapped in markdown
      const markdownJsonResponse = `\`\`\`json
      {
        "type": "fix",
        "description": "correct high-priority bug"
      }
      \`\`\``;

      const mockResponse = { response: { text: () => markdownJsonResponse } };

      const generateContentStub = sandbox.stub().resolves(mockResponse);

      const mockGenAI = {
        getGenerativeModel: sandbox.stub().returns({
          generateContent: generateContentStub,
        }),
      };

      const result = await generateDetailedCommit(mockGenAI as any, "diff", "context");

      assert.strictEqual(result.type, "fix");
      assert.strictEqual(result.description, "correct high-priority bug");
    });

    test("Should return a fallback object when AI returns malformed JSON", async () => {
      // Mocking a broken JSON response
      const malformedJsonResponse = `{"type": "refactor", "description": "update old code",}`; // Extra comma
      const mockResponse = { response: { text: () => malformedJsonResponse } };
      const generateContentStub = sandbox.stub().resolves(mockResponse);

      const mockGenAI = {
        getGenerativeModel: sandbox.stub().returns({
          generateContent: generateContentStub,
        }),
      };

      const result = await generateDetailedCommit(mockGenAI as any, "diff", "context");

      assert.strictEqual(result.type, "feat");
      assert.strictEqual(result.description, "automated commit message");
      assert.ok(result.body?.includes("Could not parse AI response"));
    });
  });

  suite("Commit History Management", () => {
    test("`saveToCommitHistory` should add a new message and trim the history", () => {
      // Creating a mock context with a spy on `globalState.update`
      const mockMemento = {
        // DEFINING THE STORE WITH AN INDEX SIGNATURE
        store: { commitHistory: ["old commit 2", "old commit 3"] } as { [key: string]: any },
        keys: function () { return Object.keys(this.store); },
        get: function<T>(key: string, defaultValue?: T): T | undefined {
          return this.store[key] || defaultValue;
        },
        update: function (key: string, value: any): Promise<void> {
          this.store[key] = value; // This is now type-safe
          return Promise.resolve();
        },
        setKeysForSync: () => {},
      };

      const updateSpy = sandbox.spy(mockMemento, "update");
      const mockContext = { globalState: mockMemento } as any;

      // Calling the function
      saveToCommitHistory("new commit 1", mockContext);

      // Asserting that update was called with the correct new array
      assert.ok(updateSpy.calledOnce, "update should be called once");
      const updatedHistory = updateSpy.firstCall.args[1];
      assert.strictEqual(updatedHistory.length, 3, "History should now have 3 items");
      assert.deepStrictEqual(updatedHistory, ["new commit 1", "old commit 2", "old commit 3"]);
    });

    test("`saveToCommitHistory` should respect the maximum history size of 20", () => {
        // Creating a full history with 20 items
        const fullHistory = Array.from({ length: 20 }, (_, i) => `commit ${i + 1}`);
        const mockMemento = {
            store: { commitHistory: fullHistory } as { [key: string]: any },
            keys: function () { return Object.keys(this.store); },
            get: function<T>(key: string, defaultValue?: T): T | undefined { return this.store[key] || defaultValue; },
            update: function (key: string, value: any): Promise<void> { this.store[key] = value; return Promise.resolve(); },
            setKeysForSync: () => {},
        };

        const updateSpy = sandbox.spy(mockMemento, "update");
        const mockContext = { globalState: mockMemento } as any;

        // Calling the function to add one more
        saveToCommitHistory("the newest commit", mockContext);

        const updatedHistory = updateSpy.firstCall.args[1];

        assert.strictEqual(updatedHistory.length, 20, "History should be trimmed to 20 items");
        assert.strictEqual(updatedHistory[0], "the newest commit", "The new commit should be at the start");
        assert.strictEqual(updatedHistory[19], "commit 19", "The oldest commit should be removed");
    });
  });
});