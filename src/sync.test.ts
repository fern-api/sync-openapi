import { describe, it, expect, vi, beforeEach } from "vitest";

// Use shared state objects so mocks across resetModules don't create circular refs
const state = {
    infoCalls: [] as string[],
    setFailedCalls: [] as string[],
    warningCalls: [] as string[],
    execCalls: [] as [string, string[] | undefined, unknown][], // [cmd, args, opts]
    getInputImpl: (_name: string): string => "",
    getBooleanInputImpl: (_name: string): boolean => false,
    execImpl: async (
        _cmd: string,
        _args?: string[],
    ): Promise<number> => 0,
    getExecOutputImpl: async (): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }> => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
    }),
    mockOctokit: null as any,
};

// Shared mock state for octokit calls
let mockPullsList: ReturnType<typeof vi.fn>;
let mockPullsCreate: ReturnType<typeof vi.fn>;
let mockPullsUpdate: ReturnType<typeof vi.fn>;
let mockGitGetRef: ReturnType<typeof vi.fn>;
let mockIssuesCreateComment: ReturnType<typeof vi.fn>;

// Factory mocks that delegate to shared state
vi.mock("@actions/core", () => ({
    getInput: vi.fn((...args: any[]) => state.getInputImpl(args[0])),
    getBooleanInput: vi.fn((...args: any[]) =>
        state.getBooleanInputImpl(args[0]),
    ),
    info: vi.fn((msg: string) => {
        state.infoCalls.push(msg);
    }),
    setFailed: vi.fn((msg: string) => {
        state.setFailedCalls.push(msg);
    }),
    warning: vi.fn((msg: string) => {
        state.warningCalls.push(msg);
    }),
}));

vi.mock("@actions/github", () => ({
    getOctokit: vi.fn(() => state.mockOctokit),
    context: {
        repo: { owner: "test-owner", repo: "test-repo" },
        ref: "refs/heads/main",
    },
}));

vi.mock("@actions/exec", () => ({
    exec: vi.fn(
        async (
            cmd: string,
            args?: string[],
            opts?: unknown,
        ): Promise<number> => {
            state.execCalls.push([cmd, args, opts]);
            return state.execImpl(cmd, args);
        },
    ),
    getExecOutput: vi.fn(async () => state.getExecOutputImpl()),
}));

vi.mock("@actions/io", () => ({
    mkdirP: vi.fn(),
}));

function setupMocks({
    hasChanges = true,
    existingPRNumber = null as number | null,
    branchExists = false,
    autoMerge = false,
}: {
    hasChanges?: boolean;
    existingPRNumber?: number | null;
    branchExists?: boolean;
    autoMerge?: boolean;
} = {}) {
    // Reset shared state
    state.infoCalls = [];
    state.setFailedCalls = [];
    state.warningCalls = [];
    state.execCalls = [];

    // Setup input implementations
    state.getInputImpl = (name: string): string => {
        const inputs: Record<string, string> = {
            token: "fake-token",
            branch: "update-api",
            auto_merge: "false",
            update_from_source: "true",
        };
        return inputs[name] || "";
    };
    state.getBooleanInputImpl = (name: string): boolean => {
        if (name === "auto_merge") return autoMerge;
        if (name === "update_from_source") return true;
        return false;
    };

    // Setup exec implementations
    state.execImpl = async (_cmd: string, _args?: string[]) => 0;
    state.getExecOutputImpl = async () => ({
        stdout: hasChanges ? "M openapi/openapi.json\n" : "",
        stderr: "",
        exitCode: 0,
    });

    // Setup GitHub octokit mocks
    mockPullsList = vi.fn().mockResolvedValue({
        data: existingPRNumber ? [{ number: existingPRNumber }] : [],
    });
    mockPullsCreate = vi.fn().mockResolvedValue({
        data: { html_url: "https://github.com/test-owner/test-repo/pull/1" },
    });
    mockPullsUpdate = vi.fn().mockResolvedValue({});
    mockIssuesCreateComment = vi.fn().mockResolvedValue({});
    mockGitGetRef = branchExists
        ? vi.fn().mockResolvedValue({})
        : vi.fn().mockRejectedValue(new Error("Not found"));

    state.mockOctokit = {
        rest: {
            pulls: {
                list: mockPullsList,
                create: mockPullsCreate,
                update: mockPullsUpdate,
            },
            git: {
                getRef: mockGitGetRef,
            },
            issues: {
                createComment: mockIssuesCreateComment,
            },
        },
    };
}

async function importAndRun() {
    vi.resetModules();

    const { run } = await import("./sync");
    await run();
}

beforeEach(() => {
    vi.clearAllMocks();
    state.infoCalls = [];
    state.setFailedCalls = [];
    state.warningCalls = [];
    state.execCalls = [];
});

describe("updateFromSourceSpec", () => {
    describe("when changes are detected and no existing PR", () => {
        it("should create a new PR", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            await importAndRun();

            expect(mockPullsCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    head: "update-api",
                    base: "main",
                }),
            );
        });

        it("should check for existing PRs before creating", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            await importAndRun();

            expect(mockPullsList).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    head: "test-owner:update-api",
                    state: "open",
                }),
            );

            expect(mockPullsCreate).toHaveBeenCalledTimes(1);
        });
    });

    describe("when changes are detected and an existing PR exists", () => {
        it("should NOT create a new PR", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: 42 });
            await importAndRun();

            expect(mockPullsList).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    head: "test-owner:update-api",
                    state: "open",
                }),
            );

            expect(mockPullsCreate).not.toHaveBeenCalled();
        });

        it("should log that the existing PR was reused", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: 42 });
            await importAndRun();

            expect(state.infoCalls).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("PR #42 already exists"),
                ]),
            );
        });
    });

    describe("when no changes are detected", () => {
        it("should not push or create a PR", async () => {
            setupMocks({ hasChanges: false });
            await importAndRun();

            expect(mockPullsCreate).not.toHaveBeenCalled();
            expect(state.infoCalls).toContain(
                "No changes detected from fern api update. Skipping further actions.",
            );
        });
    });

    describe("git push behavior", () => {
        it("should push without --force flag", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            await importAndRun();

            const pushCall = state.execCalls.find(
                ([cmd, args]) =>
                    cmd === "git" &&
                    Array.isArray(args) &&
                    args.includes("push"),
            );

            expect(pushCall).toBeDefined();
            expect(pushCall![1]).not.toContain("--force");
            expect(pushCall![1]).toContain("--verbose");
            expect(pushCall![1]).toContain("origin");
            expect(pushCall![1]).toContain("update-api");
        });

        it("should rebase and retry push when regular push fails", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            let pushAttempt = 0;
            state.execImpl = async (
                cmd: string,
                args?: string[],
            ): Promise<number> => {
                if (
                    cmd === "git" &&
                    Array.isArray(args) &&
                    args.includes("push")
                ) {
                    pushAttempt++;
                    if (pushAttempt === 1) {
                        throw new Error("rejected (non-fast-forward)");
                    }
                }
                return 0;
            };
            await importAndRun();

            // Should have attempted push twice (initial + after rebase)
            const pushCalls = state.execCalls.filter(
                ([cmd, args]) =>
                    cmd === "git" &&
                    Array.isArray(args) &&
                    args.includes("push"),
            );
            expect(pushCalls.length).toBe(2);

            // Should have done a pull --rebase between pushes
            const rebasePull = state.execCalls.find(
                ([cmd, args]) =>
                    cmd === "git" &&
                    Array.isArray(args) &&
                    args.includes("pull") &&
                    args.includes("--rebase"),
            );
            expect(rebasePull).toBeDefined();

            // PR should still be created after successful retry
            expect(mockPullsCreate).toHaveBeenCalledTimes(1);
        });

        it("should comment on PR when push and rebase both fail", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: 42 });
            state.execImpl = async (
                cmd: string,
                args?: string[],
            ): Promise<number> => {
                if (
                    cmd === "git" &&
                    Array.isArray(args) &&
                    (args.includes("push") ||
                        (args.includes("pull") && args.includes("--rebase")))
                ) {
                    throw new Error("merge conflict");
                }
                return 0;
            };
            await importAndRun();

            // Should NOT create a new PR
            expect(mockPullsCreate).not.toHaveBeenCalled();

            // Should leave a comment on the existing PR
            expect(mockIssuesCreateComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: "test-owner",
                    repo: "test-repo",
                    issue_number: 42,
                }),
            );

            // Comment body should mention sync failed and include error details
            const commentCall = mockIssuesCreateComment.mock.calls[0][0];
            expect(commentCall.body).toContain("Sync failed");
            expect(commentCall.body).toContain("merge conflicts");
            expect(commentCall.body).toContain("Rebase error:");
            expect(commentCall.body).toContain("merge conflict");

            // Action should still fail (not silently succeed)
            expect(state.setFailedCalls).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("conflicts"),
                ]),
            );
        });

        it("should call setFailed when push fails and no existing PR to comment on", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: null });
            state.execImpl = async (
                cmd: string,
                args?: string[],
            ): Promise<number> => {
                if (
                    cmd === "git" &&
                    Array.isArray(args) &&
                    (args.includes("push") ||
                        (args.includes("pull") && args.includes("--rebase")))
                ) {
                    throw new Error("merge conflict");
                }
                return 0;
            };
            await importAndRun();

            expect(mockPullsCreate).not.toHaveBeenCalled();
            expect(mockIssuesCreateComment).not.toHaveBeenCalled();
            expect(state.setFailedCalls).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("Failed to push changes"),
                ]),
            );
        });

        it("should include rebase abort error in PR comment when abort fails", async () => {
            setupMocks({ hasChanges: true, existingPRNumber: 42 });
            state.execImpl = async (
                cmd: string,
                args?: string[],
            ): Promise<number> => {
                if (
                    cmd === "git" &&
                    Array.isArray(args) &&
                    (args.includes("push") ||
                        (args.includes("pull") && args.includes("--rebase")))
                ) {
                    throw new Error("merge conflict");
                }
                if (
                    cmd === "git" &&
                    Array.isArray(args) &&
                    args.includes("rebase") &&
                    args.includes("--abort")
                ) {
                    throw new Error("no rebase in progress");
                }
                return 0;
            };
            await importAndRun();

            const commentCall = mockIssuesCreateComment.mock.calls[0][0];
            expect(commentCall.body).toContain("Rebase error:");
            expect(commentCall.body).toContain("merge conflict");
            expect(commentCall.body).toContain("Rebase abort error:");
            expect(commentCall.body).toContain("no rebase in progress");
        });
    });

    describe("dynamic branch name warning", () => {
        it("should warn when branch name contains an ISO date", async () => {
            setupMocks({ hasChanges: false });
            state.getInputImpl = (name: string): string => {
                const inputs: Record<string, string> = {
                    token: "fake-token",
                    branch: "update-openapi-spec-2026-02-25T00-27-08-474Z",
                    auto_merge: "false",
                    update_from_source: "true",
                };
                return inputs[name] || "";
            };
            await importAndRun();

            expect(state.warningCalls).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("appears to contain a timestamp"),
                ]),
            );
        });

        it("should not warn for a stable branch name", async () => {
            setupMocks({ hasChanges: false });
            await importAndRun();

            expect(state.warningCalls).not.toEqual(
                expect.arrayContaining([
                    expect.stringContaining("appears to contain a timestamp"),
                ]),
            );
        });
    });

    describe("when auto_merge is true", () => {
        it("should not check for existing PRs or create new ones", async () => {
            setupMocks({ hasChanges: true, autoMerge: true });
            await importAndRun();

            expect(mockPullsList).not.toHaveBeenCalled();
            expect(mockPullsCreate).not.toHaveBeenCalled();

            expect(state.infoCalls).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("auto-merge is enabled"),
                ]),
            );
        });
    });
});
