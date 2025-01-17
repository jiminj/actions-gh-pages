import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as io from '@actions/io';
import path from 'path';
import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cpSpawnSync = require('child_process').spawnSync;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cpexec = require('child_process').execFileSync;
import {Inputs} from './interfaces';
import {getHomeDir} from './utils';
import {parseAddress} from './git-utils';

export async function setSSHKey(inps: Inputs, publishRepo: string): Promise<string> {
  core.info('[INFO] setup SSH deploy key');
  const [host, pathname] = parseAddress(publishRepo);
  const [sshProxyHost, sshProxyPort] = parseAddress(inps.SshProxy)[0].split(':');

  const homeDir = await getHomeDir();
  const sshDir = path.join(homeDir, '.ssh');
  await io.mkdirP(sshDir);
  await exec.exec('chmod', ['700', sshDir]);

  const knownHosts = path.join(sshDir, 'known_hosts');

  // ssh-keyscan -t rsa github.com or serverUrl >> ~/.ssh/known_hosts on Ubuntu
  const hostKey = await (async () => {
    try {
      const portOption = sshProxyPort ? ['-p', sshProxyPort] : [];
      const keyScanHost = sshProxyHost || host;
      core.info(`[INFO] scanning SSH keys to ${keyScanHost}` + portOption ? `:${portOption}` : '');
      const keyscanOutput = await exec.getExecOutput('ssh-keyscan', [
        '-t',
        'rsa',
        ...portOption,
        keyScanHost
      ]);
      return keyscanOutput.stderr + keyscanOutput.stdout;
    } catch (e) {
      core.info('[INFO] ssh-scan failed. Returning default keys');
      return `\
# github.com:22 SSH-2.0-babeld-1f0633a6
github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==
# ssh.github.com:443 SSH-2.0-babeld-17a926d7
[ssh.github.com]:443 ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==
`;
    }
  })();

  fs.writeFileSync(knownHosts, hostKey);
  core.info(`[INFO] wrote ${knownHosts}`);
  await exec.exec('chmod', ['600', knownHosts]);

  const idRSA = path.join(sshDir, 'github');
  fs.writeFileSync(idRSA, inps.DeployKey + '\n');
  core.info(`[INFO] wrote ${idRSA}`);
  await exec.exec('chmod', ['600', idRSA]);

  const sshConfigPath = path.join(sshDir, 'config');
  const sshConfigContent =
    `\
Host ${host}
    HostName ${sshProxyHost || host}
    IdentityFile ~/.ssh/github
    User git
` + (sshProxyPort ? `    Port ${sshProxyPort}\n` : '');

  fs.writeFileSync(sshConfigPath, sshConfigContent + '\n');
  core.info(`[INFO] wrote ${sshConfigPath}`);
  await exec.exec('chmod', ['600', sshConfigPath]);

  if (process.platform === 'win32') {
    core.warning(`\
Currently, the deploy_key option is not supported on the windows-latest.
Watch https://github.com/peaceiris/actions-gh-pages/issues/87
`);

    await cpSpawnSync('Start-Process', ['powershell.exe', '-Verb', 'runas']);
    await cpSpawnSync('sh', ['-c', '\'eval "$(ssh-agent)"\''], {shell: true});
    await exec.exec('sc', ['config', 'ssh-agent', 'start=auto']);
    await exec.exec('sc', ['start', 'ssh-agent']);
  }
  await cpexec('ssh-agent', ['-a', '/tmp/ssh-auth.sock']);
  core.exportVariable('SSH_AUTH_SOCK', '/tmp/ssh-auth.sock');
  await exec.exec('ssh-add', [idRSA]);

  return `git@${host}:${pathname}.git`;
}

export function setGithubToken(
  githubToken: string,
  publishRepo: string,
  publishBranch: string,
  externalRepository: string,
  ref: string,
  eventName: string
): string {
  core.info('[INFO] setup GITHUB_TOKEN');

  core.debug(`ref: ${ref}`);
  core.debug(`eventName: ${eventName}`);
  let isProhibitedBranch = false;

  if (externalRepository) {
    throw new Error(`\
The generated GITHUB_TOKEN (github_token) does not support to push to an external repository.
Use deploy_key or personal_token.
`);
  }

  if (eventName === 'push') {
    isProhibitedBranch = ref.match(new RegExp(`^refs/heads/${publishBranch}$`)) !== null;
    if (isProhibitedBranch) {
      throw new Error(`\
You deploy from ${publishBranch} to ${publishBranch}
This operation is prohibited to protect your contents
`);
    }
  }
  const [host, pathname] = parseAddress(publishRepo);
  return `https://x-access-token:${githubToken}@${host}/${pathname}.git`;
}

export function setPersonalToken(personalToken: string, publishRepo: string): string {
  core.info('[INFO] setup personal access token');
  const [host, pathname] = parseAddress(publishRepo);
  return `https://x-access-token:${personalToken}@${host}/${pathname}.git`;
}

export function getPublishRepo(
  externalRepository: string,
  defaultServer: string,
  owner: string,
  repo: string
): string {
  const countSlashes = (str: string) => {
    return (str.match(/\//g) || []).length;
  };
  const sanitizedDefaultServer = parseAddress(defaultServer)[0];
  if (!externalRepository) {
    return `${sanitizedDefaultServer}/${owner}/${repo}`;
  }
  const sanitizedExternalRepo = parseAddress(externalRepository).join('/');
  return countSlashes(sanitizedExternalRepo) <= 1
    ? `${sanitizedDefaultServer}/${sanitizedExternalRepo}`
    : sanitizedExternalRepo;
}

export async function setTokens(inps: Inputs): Promise<string> {
  try {
    const publishRepo = getPublishRepo(
      inps.ExternalRepository,
      github.context.serverUrl,
      github.context.repo.owner,
      github.context.repo.repo
    );
    if (inps.DeployKey) {
      return setSSHKey(inps, publishRepo);
    } else if (inps.GithubToken) {
      const context = github.context;
      const ref = context.ref;
      const eventName = context.eventName;
      return setGithubToken(
        inps.GithubToken,
        publishRepo,
        inps.PublishBranch,
        inps.ExternalRepository,
        ref,
        eventName
      );
    } else if (inps.PersonalToken) {
      return setPersonalToken(inps.PersonalToken, publishRepo);
    } else {
      throw new Error('not found deploy key or tokens');
    }
  } catch (e) {
    throw new Error(e.message);
  }
}
