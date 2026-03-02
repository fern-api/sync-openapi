import { describe, it, expect, vi, beforeEach } from "vitest";

// Use shared state objects so mocks across resetModules don't create circular refs
const state = {
    infoCalls: [] as string[],
    setFailedCalls: [] as string[],
    execCalls: [] as [string, string[] | undefined, unknown][], // [cmd, args, opts]
    getInputImpl: (_name: string): string => "",
    getBooleanInputImpl: (_name: string): boolean => false,
    execImpl: async (): Promise<number> => 0,
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
            return state.execImpl();
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
    state.execImpl = async () => 0;
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
        },
    };
}

async function importAndRun() {
    vi.resetModules();

    await import("./sync");

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
}

beforeEach(() => {
    vi.clearAllMocks();
    state.infoCalls = [];
    state.setFailedCalls = [];
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
