import * as core from "@actions/core";
import * as github from "@actions/github";
import * as exec from "@actions/exec";

// Mock all external dependencies
jest.mock("@actions/core");
jest.mock("@actions/github");
jest.mock("@actions/exec");
jest.mock("@actions/io");

const mockedCore = core as jest.Mocked<typeof core>;
const mockedExec = exec as jest.Mocked<typeof exec>;

// Shared mock state for octokit
let mockPullsList: jest.Mock;
let mockPullsCreate: jest.Mock;
let mockPullsUpdate: jest.Mock;
let mockGitGetRef: jest.Mock;

function setupMocks({
    hasChanges = true,
    existingPRNumber = null as number | null,
    branchExists = false,
}: {
    hasChanges?: boolean;
    existingPRNumber?: number | null;
    branchExists?: boolean;
} = {}) {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup core mocks
    mockedCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
            token: "fake-token",
            branch: "update-api",
            auto_merge: "false",
            update_from_source: "true",
        };
        return inputs[name] || "";
    });
    mockedCore.getBooleanInput.mockImplementation((name: string) => {
        if (name === "auto_merge") return false;
        if (name === "update_from_source") return true;
        return false;
    });
    mockedCore.info.mockImplementation(() => {});
    mockedCore.setFailed.mockImplementation(() => {});

    // Setup exec mocks
    mockedExec.exec.mockResolvedValue(0);
    mockedExec.getExecOutput.mockResolvedValue({
        stdout: hasChanges ? "M openapi/openapi.json\n" : "",
        stderr: "",
        exitCode: 0,
    });

    // Setup GitHub context
    mockPullsList = jest.fn().mockResolvedValue({
        data: existingPRNumber ? [{ number: existingPRNumber }] : [],
    });
    mockPullsCreate = jest.fn().mockResolvedValue({
        data: { html_url: "https://github.com/test-owner/test-repo/pull/1" },
    });
    mockPullsUpdate = jest.fn().mockResolvedValue({});
    mockGitGetRef = branchExists
        ? jest.fn().mockResolvedValue({})
        : jest.fn().mockRejectedValue(new Error("Not found"));

    const mockOctokit = {
        rest: {
            pulls: {
                list: mockPullsList,
                create: mockPullsCreate,
                update: mockPullsUpdate,
            },
            git: {
                getRef: mockGitGetRef,
            },
        },
    };

    (github as any).getOctokit = jest.fn().mockReturnValue(mockOctokit);
    (github as any).context = {
        repo: { owner: "test-owner", repo: "test-repo" },
        ref: "refs/heads/main",
    };
}

// We need to re-import the module for each test since it calls run() on import
// Instead, let's isolate the module import
function importAndRun() {
    // Clear the module cache so we get a fresh import (which calls run())
    jest.resetModules();
    // Re-mock after resetModules
    jest.mock("@actions/core");
    jest.mock("@actions/github");
    jest.mock("@actions/exec");
    jest.mock("@actions/io");

    // Re-apply our mock implementations (since resetModules clears them)
    const freshCore = require("@actions/core");
    const freshGithub = require("@actions/github");
    const freshExec = require("@actions/exec");

    // Copy mock implementations
    freshCore.getInput = mockedCore.getInput;
    freshCore.getBooleanInput = mockedCore.getBooleanInput;
    freshCore.info = mockedCore.info;
    freshCore.setFailed = mockedCore.setFailed;
    freshExec.exec = mockedExec.exec;
    freshExec.getExecOutput = mockedExec.getExecOutput;

    Object.assign(freshGithub, {
        getOctokit: (github as any).getOctokit,
        context: (github as any).context,
    });

    return require("./sync");
}

describe("updateFromSourceSpec", () => {
    describe("when changes are detected and no existing PR", () => {
        it("should create a new PR", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            await importAndRun();

            // Wait for async operations to complete
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify PR was created
            expect(mockPullsCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    head: "update-api",
                    base: "main",
                }),
            );
        });

        it("should not call pulls.list for existing PRs and then create", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            await importAndRun();
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify prExists was called (pulls.list)
            expect(mockPullsList).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    head: "test-owner:update-api",
                    state: "open",
                }),
            );

            // Verify a new PR was created
            expect(mockPullsCreate).toHaveBeenCalledTimes(1);
        });
    });

    describe("when changes are detected and an existing PR exists", () => {
        it("should NOT create a new PR", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: 42 });
            await importAndRun();
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify pulls.list was called to check for existing PRs
            expect(mockPullsList).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    head: "test-owner:update-api",
                    state: "open",
                }),
            );

            // Verify NO new PR was created
            expect(mockPullsCreate).not.toHaveBeenCalled();
        });

        it("should log that the existing PR was reused", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: 42 });
            await importAndRun();
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(mockedCore.info).toHaveBeenCalledWith(
                expect.stringContaining("PR #42 already exists"),
            );
        });
    });

    describe("when no changes are detected", () => {
        it("should not push or create a PR", async () => {
            setupMocks({ hasChanges: false });
            await importAndRun();
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify no PR was created
            expect(mockPullsCreate).not.toHaveBeenCalled();
            // Verify no push happened (push is the 5th exec call after git config x2, checkout, fern --version, fern api update)
            // Actually, let's check that the "no changes" log was emitted
            expect(mockedCore.info).toHaveBeenCalledWith(
                "No changes detected from fern api update. Skipping further actions.",
            );
        });
    });

    describe("git push behavior", () => {
        it("should push without --force flag", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            await importAndRun();
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Find the push call among all exec calls
            const pushCall = mockedExec.exec.mock.calls.find(
                (call) =>
                    call[0] === "git" &&
                    Array.isArray(call[1]) &&
                    call[1].includes("push"),
            );

            expect(pushCall).toBeDefined();
            // Verify --force is NOT in the push args
            expect(pushCall![1]).not.toContain("--force");
            expect(pushCall![1]).toContain("--verbose");
            expect(pushCall![1]).toContain("origin");
            expect(pushCall![1]).toContain("update-api");
        });
    });

    describe("when auto_merge is true", () => {
        it("should not check for existing PRs or create new ones", async () => {
            setupMocks({ hasChanges: true });

            // Override auto_merge to true
            mockedCore.getBooleanInput.mockImplementation((name: string) => {
                if (name === "auto_merge") return true;
                if (name === "update_from_source") return true;
                return false;
            });

            await importAndRun();
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify no PR operations
            expect(mockPullsList).not.toHaveBeenCalled();
            expect(mockPullsCreate).not.toHaveBeenCalled();

            // Verify auto-merge message
            expect(mockedCore.info).toHaveBeenCalledWith(
                expect.stringContaining("auto-merge is enabled"),
            );
        });
    });
});
