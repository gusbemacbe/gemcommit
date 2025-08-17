import * as assert from "assert";
import * as vscode from "vscode";
const fs = require("fs");

import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import { getApiKey } from "../extension";

suite("API Key Test Suite", () => {
  vscode.window.showInformationMessage("Starting all tests.");

  suite("API Key Retrieval", () => {
    // A sandbox is used to easily manage and restore all stubs
    let sandbox: sinon.SinonSandbox;

    // Creating the sandbox before each test
    setup(() => {
      sandbox = sinon.createSandbox();
    });

    // Restoring the sandbox after each test to remove all stubs
    teardown(() => {
      sandbox.restore();
    });

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
});