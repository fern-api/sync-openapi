import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as glob from 'glob';
import { minimatch } from 'minimatch';

interface SourceMapping {
  from: string;
  to: string;
  exclude?: string[];
}

interface SyncOptions {
  repository: string;
  mappings: SourceMapping[];
  token?: string;
  branch?: string;
  autoMerge?: boolean;
  updateFromSource?: boolean;
}

export async function run(): Promise<void> {
  try {
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;
    let branch = core.getInput('branch', { required: true });
    const autoMerge = core.getBooleanInput('auto_merge') || false;
    const addTimestamp = core.getBooleanInput('add_timestamp') || true;
    const updateFromSource = core.getBooleanInput('update_from_source') || false;

    if (!token) {
      throw new Error('GitHub token is required. Please provide a token with appropriate permissions.');
    }

    if (updateFromSource) {
      await updateFromSourceSpec(token, branch, autoMerge);
    } else {
      await updateTargetSpec(token, branch, autoMerge);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

async function updateFromSourceSpec(token: string, branch: string, autoMerge: boolean): Promise<void> {  
  if (!token) {
    throw new Error('GitHub token is required. Please provide a token with appropriate permissions.');
  }
  
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  
  try {
    await exec.exec('git', ['config', 'user.name', 'github-actions']);
    await exec.exec('git', ['config', 'user.email', 'github-actions@github.com']);
    
    core.info(`Creating and checking out branch: ${branch}`);
    await exec.exec('git', ['checkout', '-b', branch]);
    
    await runFernApiUpdate();
    
    const diff = await exec.getExecOutput('git', ['status', '--porcelain'], {silent: true});
    
    if (!diff.stdout.trim()) {
      core.info('No changes detected from fern api update. Skipping further actions.');
      return;
    }
    
    await exec.exec('git', ['add', '.'], { silent: true });
    await exec.exec('git', ['commit', '-m', 'Update API specifications with fern api update'], { silent: true });
    
    core.info(`Pushing changes to branch: ${branch}`);

    await exec.exec('git', ['push', '--verbose', 'origin', branch], { silent: false });
    
    if (!autoMerge) {
      const octokit = github.getOctokit(token);
      await createPR(octokit, owner, repo, branch, github.context.ref.replace('refs/heads/', ''), true);
    } else {
      core.info(`Changes pushed directly to branch '${branch}' because auto-merge is enabled.`);
    }
  } catch (error) {
    throw new Error(`Failed to update from source: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function updateTargetSpec(token: string, branch: string, autoMerge: boolean): Promise<void> {
  const repository = core.getInput('repository', { required: true });
  const fileMappingInput = core.getInput('sources', { required: true });
  let fileMapping: SourceMapping[];
  
  try {
    fileMapping = yaml.load(fileMappingInput) as SourceMapping[];
  } catch (yamlError) {
    try {
      fileMapping = JSON.parse(fileMappingInput) as SourceMapping[];
    } catch (jsonError) {
      throw new Error(`Failed to parse 'sources' input as either YAML or JSON. Please check the format. Error: ${(yamlError as Error).message}`);
    }
  }
  
  if (!Array.isArray(fileMapping) || fileMapping.length === 0) {
    throw new Error('File mapping must be a non-empty array');
  }
  
  for (const [index, mapping] of fileMapping.entries()) {
    if (!mapping.from || !mapping.to) {
      throw new Error(`File mapping at index ${index} is missing required 'from' or 'to' field`);
    }
  }
  
  const options: SyncOptions = {
    repository,
    mappings: fileMapping,
    token,
    branch,
    autoMerge
  };
  
  await cloneRepository(options);
  await syncChanges(options);
}

async function runFernApiUpdate(): Promise<void> {
  try {
    core.info('Running "fern api update" command');
    
    try {
      await exec.exec('fern', ['--version'], { silent: true });
      core.info('Fern CLI is already installed');
    } catch (error) {
      core.info('Fern CLI not found. Installing Fern CLI...');
      await exec.exec('npm', ['install', '-g', 'fern-api']);
    }
    
    await exec.exec('fern', ['api', 'update']);
    
    core.info('Fern API update completed');
  } catch (error) {
    throw new Error(`Failed to run "fern api update": ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function cloneRepository(options: SyncOptions): Promise<void> {
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
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to verify repository access: ${error.message}`);
    } else {
      throw new Error('An unknown error occurred while verifying repository access');
    }
  }

  const repoUrl = `https://x-access-token:${options.token}@github.com/${options.repository}.git`;
  const repoDir = 'temp-fern-config';
  
  core.info(`Cloning repository ${options.repository} to ${repoDir}`);
  await io.mkdirP(repoDir);
  
  try {
    await exec.exec('git', ['clone', repoUrl, repoDir]);
  } catch (error) {
    throw new Error(`Failed to clone repository. Please ensure your token has 'repo' scope and you have write access to ${options.repository}.`);
  }
  
  process.chdir(repoDir);
  await exec.exec('git', ['config', 'user.name', 'github-actions']);
  await exec.exec('git', ['config', 'user.email', 'github-actions@github.com']);
}

async function syncChanges(options: SyncOptions): Promise<void> {
  if (!options.token) {
    core.warning('GitHub token not provided. Skipping changes.');
    return;
  }
  
  const octokit = github.getOctokit(options.token);
  const [owner, repo] = options.repository.split('/');
  
  try {
    const workingBranch = options.branch!;
    
    if (options.autoMerge) {
      core.info(`Auto-merge enabled. Will push directly to branch: ${workingBranch}`);
    } else {
      core.info(`Auto-merge disabled. Will create PR from branch: ${workingBranch} to main`);
    }
    
    const doesBranchExist = await branchExists(owner, repo, workingBranch, octokit);
    await setupBranch(workingBranch, doesBranchExist);

    await processSourceMappings(options);
    
    const diff = await exec.getExecOutput('git', ['status', '--porcelain'], {silent: true});
  
    if (!diff.stdout.trim()) {
      core.info('No changes detected. Skipping further actions.');
      return;
    }
    
    await commitChanges();
    
    const pushedChanges = await pushChanges(workingBranch, options);
    if (!pushedChanges) return;
    
    if (!options.autoMerge) {
      const existingPRNumber = await prExists(owner, repo, workingBranch, octokit);
      
      if (existingPRNumber) {
        await updatePR(octokit, owner, repo, existingPRNumber);
      } else {
        await createPR(octokit, owner, repo, workingBranch, 'main', false);
      }
    } else {
      core.info(`Changes pushed directly to branch '${workingBranch}' because auto-merge is enabled.`);
    }
  } catch (error) {
    throw new Error(`Failed to sync changes: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function branchExists(owner: string, repo: string, branchName: string, octokit: any): Promise<boolean> {
  try {
    await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branchName}`
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function setupBranch(branchName: string, exists: boolean): Promise<void> {
  try {
    if (exists) {
      core.info(`Branch ${branchName} exists. Checking it out.`);
      await exec.exec('git', ['checkout', branchName]);
      await exec.exec('git', ['pull', 'origin', branchName], { silent: true });
    } else {
      core.info(`Branch ${branchName} does not exist. Creating it.`);
      await exec.exec('git', ['checkout', '-b', branchName]);
    }
  } catch (error) {
    throw new Error(`Failed to setup branch ${branchName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function processSourceMappings(options: SyncOptions): Promise<void> {
  core.info('Processing source mappings');
  
  const sourceRepoRoot = path.resolve(process.env.GITHUB_WORKSPACE || '');
  const destRepoRoot = path.resolve('.');
  
  for (const mapping of options.mappings) {
    const sourcePath = path.join(sourceRepoRoot, mapping.from);
    const destPath = path.join(destRepoRoot, mapping.to);
    
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source path ${mapping.from} not found`);
    }
    
    const sourceStats = fs.statSync(sourcePath);
    
    if (sourceStats.isDirectory()) {
      core.info(`Syncing directory ${mapping.from}`);
      await syncDirectory(sourcePath, destPath, mapping.exclude);
    } else {
      core.info(`Syncing file ${mapping.from}`);
      await syncFile(sourcePath, destPath);
    }
  }
}

async function syncDirectory(sourceDirPath: string, destDirPath: string, excludePatterns?: string[]): Promise<void> {
  
  await io.mkdirP(destDirPath);
  
  const files = glob.sync('**/*', { 
    cwd: sourceDirPath, 
    nodir: true,
    absolute: false
  });
  
  for (const file of files) {
    const sourceFilePath = path.join(sourceDirPath, file);
    const destFilePath = path.join(destDirPath, file);
    
    if (excludePatterns && isExcluded(sourceFilePath, excludePatterns)) {
      core.info(`Skipping ${file}`);
      continue;
    }
    
    await syncFile(sourceFilePath, destFilePath);
  }
}

async function syncFile(sourceFilePath: string, destFilePath: string): Promise<void> {
  await io.mkdirP(path.dirname(destFilePath));
  fs.copyFileSync(sourceFilePath, destFilePath);
}

function isExcluded(filePath: string, excludePatterns: string[]): boolean {
  const sourceRepoRoot = path.resolve(process.env.GITHUB_WORKSPACE || '');
  const relativePath = path.relative(sourceRepoRoot, filePath);
  return excludePatterns.some(pattern => minimatch(relativePath, pattern));
}

async function commitChanges(): Promise<void> {
  await exec.exec('git', ['add', '.'], { silent: true });
  await exec.exec('git', ['commit', '-m', `Sync OpenAPI files from ${github.context.repo.repo}`], { silent: true });
}

async function hasDifferenceWithRemote(branchName: string): Promise<boolean> {
  try {
    await exec.exec('git', ['fetch', 'origin', branchName], { silent: true });
    
    const diff = await exec.getExecOutput('git', ['diff', `HEAD`, `origin/${branchName}`], { silent: true });
    
    return !!diff.stdout.trim();
  } catch (error) {
    core.info(`Could not fetch remote branch, assuming this is the first push to new branch.`);
    return true;
  }
}

async function pushChanges(branchName: string, options: SyncOptions): Promise<boolean> {
  try {
    let shouldPush = true;
    
    if (!options.autoMerge) {
      shouldPush = await hasDifferenceWithRemote(branchName);
    }
    
    if (shouldPush) {
      await exec.exec('git', ['push', '--force', 'origin', branchName], { silent: true });
      return true;
    } else {
      core.info(`No differences with remote branch. Skipping push.`);
      return false;
    }
  } catch (error) {
    throw new Error(`Failed to push changes to the repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Check if a PR exists for a branch
async function prExists(owner: string, repo: string, branchName: string, octokit: any): Promise<number | null> {
  const prs = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branchName}`,
    state: 'open'
  });
  
  return prs.data.length > 0 ? prs.data[0].number : null;
}

// Update an existing PR
async function updatePR(octokit: any, owner: string, repo: string, prNumber: number): Promise<void> {
  core.info(`Updating PR #${prNumber}`);
  
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    body: `Update OpenAPI specifications based on changes in the source repository.\nUpdated: ${new Date().toISOString()}`
  });
}

// Create a new PR
async function createPR(octokit: any, owner: string, repo: string, branchName: string, targetBranch: string, isFromFern: boolean): Promise<any> {
  core.info(`Creating new PR from ${branchName} to ${targetBranch}`);
  const date = new Date().toISOString().replace(/[:.]/g, '-');
    
  
  let prTitle = isFromFern ? 
    'chore: Update API specifications with fern api update (${date})' : 
    'chore: Update OpenAPI specifications (${date})';
  
  let prBody = isFromFern ? 
    'Update API specifications by running fern api update.' : 
    'Update OpenAPI specifications based on changes in the source repository.';
  
  const prResponse = await octokit.rest.pulls.create({
    owner,
    repo,
    title: prTitle,
    head: branchName,
    base: targetBranch,
    body: prBody
  });
  
  core.info(`Pull request created: ${prResponse.data.html_url}`);
  return prResponse;
}

run();