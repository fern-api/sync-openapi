"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const exec = __importStar(require("@actions/exec"));
const io = __importStar(require("@actions/io"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
async function run() {
    try {
        const repository = core.getInput('repository', { required: true });
        const token = core.getInput('token') || process.env.GITHUB_TOKEN;
        const branch = core.getInput('branch') || 'update-openapi';
        const autoMerge = core.getBooleanInput('auto_merge') || false;
        const openApiInput = core.getInput('openapi', { required: true });
        let openapi;
        try {
            openapi = yaml.load(openApiInput);
        }
        catch (yamlError) {
            try {
                openapi = JSON.parse(openApiInput);
            }
            catch (jsonError) {
                throw new Error(`Failed to parse 'openapi' input as either YAML or JSON. Please check the format. Error: ${yamlError.message}`);
            }
        }
        if (!Array.isArray(openapi) || openapi.length === 0) {
            throw new Error('OpenAPI mapping must be a non-empty array');
        }
        for (const [index, mapping] of openapi.entries()) {
            if (!mapping.source || !mapping.destination) {
                throw new Error(`OpenAPI mapping at index ${index} is missing required 'source' or 'destination' field`);
            }
        }
        const options = {
            repository,
            openapi,
            token,
            branch,
            autoMerge
        };
        await cloneRepository(options);
        await copyOpenAPIFiles(options);
        // await createPullRequest(options);
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed('An unknown error occurred');
        }
    }
}
async function cloneRepository(options) {
    if (!options.token) {
        throw new Error('GitHub token is required to authenticate and clone the repository. Please provide a token with appropriate permissions.');
    }
    try {
        const octokit = github.getOctokit(options.token);
        const [owner, repo] = options.repository.split('/');
        await octokit.rest.repos.get({
            owner,
            repo
        });
        core.info('Successfully authenticated with the target repository');
    }
    catch (error) {
        if (error instanceof Error) {
            if (error.message.includes('Not Found')) {
                throw new Error(`Repository ${options.repository} not found or you don't have permission to access it. Please check the repository name and ensure your token has the required permissions.`);
            }
            else if (error.message.includes('Bad credentials')) {
                throw new Error('Authentication failed. Please check that your token is valid and has not expired.');
            }
            else {
                throw new Error(`Failed to verify repository access: ${error.message}`);
            }
        }
        else {
            throw new Error('An unknown error occurred while verifying repository access');
        }
    }
    const repoUrl = `https://x-access-token:${options.token}@github.com/${options.repository}.git`;
    const repoDir = 'fern-config';
    core.info(`Cloning repository ${options.repository} to ${repoDir}`);
    await io.mkdirP(repoDir);
    try {
        await exec.exec('git', ['clone', repoUrl, repoDir]);
    }
    catch (error) {
        throw new Error(`Failed to clone repository. Please ensure your token has 'repo' scope and you have write access to ${options.repository}.`);
    }
    process.chdir(repoDir);
    await exec.exec('git', ['config', 'user.name', 'github-actions']);
    await exec.exec('git', ['config', 'user.email', 'github-actions@github.com']);
    await exec.exec('git', ['checkout', '-b', options.branch]);
}
async function copyOpenAPIFiles(options) {
    core.info('Copying OpenAPI files to destination locations');
    const sourceRepoRoot = path.resolve(process.env.GITHUB_WORKSPACE || '');
    const destRepoRoot = path.resolve('.');
    for (const mapping of options.openapi) {
        const sourcePath = path.join(sourceRepoRoot, mapping.source);
        const destPath = path.join(destRepoRoot, mapping.destination);
        core.info(`Checking for source file: ${sourcePath}`);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${mapping.source}`);
        }
        core.info(`Copying ${sourcePath} to ${destPath}`);
        await io.mkdirP(path.dirname(destPath));
        fs.copyFileSync(sourcePath, destPath);
    }
}
async function createPullRequest(options) {
    const diff = await exec.getExecOutput('git', ['status', '--porcelain']);
    if (!diff.stdout.trim()) {
        core.info('No changes detected. Skipping PR creation.');
        return;
    }
    await exec.exec('git', ['add', '.']);
    await exec.exec('git', ['commit', '-m', 'Update OpenAPI specifications']);
    try {
        await exec.exec('git', ['push', 'origin', options.branch]);
    }
    catch (error) {
        throw new Error(`Failed to push changes to the repository. This typically happens when your token doesn't have write access to the repository. Please ensure your token has the 'repo' scope and you have write access to ${options.repository}.`);
    }
    if (options.token) {
        const octokit = github.getOctokit(options.token);
        const [owner, repo] = options.repository.split('/');
        core.info('Creating pull request');
        try {
            const permissionsResponse = await octokit.rest.repos.getCollaboratorPermissionLevel({
                owner,
                repo,
                username: 'github-actions[bot]'
            }).catch(() => {
                return null;
            });
            if (permissionsResponse &&
                !['admin', 'write', 'maintain'].includes(permissionsResponse.data.permission)) {
                core.warning(`Limited permissions detected (${permissionsResponse.data.permission}). This may affect the ability to create PRs.`);
            }
            const prResponse = await octokit.rest.pulls.create({
                owner,
                repo,
                title: 'Update OpenAPI specifications',
                head: options.branch,
                base: 'main',
                body: 'Update OpenAPI specifications based on changes in the source repository.'
            });
            core.info(`Pull request created: ${prResponse.data.html_url}`);
            if (options.autoMerge && prResponse.data.number) {
                core.info('Attempting to auto-merge pull request');
                try {
                    await octokit.rest.pulls.merge({
                        owner,
                        repo,
                        pull_number: prResponse.data.number,
                        merge_method: 'squash'
                    });
                    core.info('Pull request auto-merged successfully');
                }
                catch (error) {
                    core.warning('Failed to auto-merge pull request. This may be due to branch protection rules or insufficient permissions. The PR will require manual review and merge.');
                }
            }
        }
        catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('Resource not accessible by integration')) {
                    throw new Error(`Failed to create PR: Your token lacks sufficient permissions. For cross-repository operations, you need a Personal Access Token (PAT) with 'repo' scope from a user who has write access to ${options.repository}.`);
                }
                else {
                    throw new Error(`Failed to create PR: ${error.message}`);
                }
            }
            else {
                throw new Error('An unknown error occurred while creating the PR');
            }
        }
    }
    else {
        core.warning('GitHub token not provided. Skipping PR creation. Changes have been pushed to the remote branch.');
    }
}
run();
