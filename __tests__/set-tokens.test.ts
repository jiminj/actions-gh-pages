import {getPublishRepo, setPersonalToken, setGithubToken, setSSHKey} from '../src/set-tokens';
import {Inputs} from '../src/interfaces';

import fs from 'fs';
import * as exec from '@actions/exec';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as core from '@actions/core';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as io from '@actions/io';

jest.mock('@actions/exec', () => ({
  exec: jest.fn(),
  getExecOutput: jest.fn().mockReturnValue({
    stderr: '# hostname',
    stdout: 'hostinfo',
    exitCode: 0
  })
}));
jest.mock('@actions/io', () => ({
  mkdirP: jest.fn()
}));
jest.mock('@actions/core');
jest.mock('fs');
jest.mock('child_process');

beforeEach(() => {
  jest.resetModules();
});

// afterEach(() => {

// });

describe('setSSHKey()', () => {
  const createInputs = (): Inputs => ({
    DeployKey: 'DEPLOY_KEY',
    GithubToken: '',
    PersonalToken: '',
    PublishBranch: 'gh-pages',
    PublishDir: '',
    DestinationDir: '',
    ExternalRepository: '',
    AllowEmptyCommit: false,
    KeepFiles: false,
    ForceOrphan: false,
    UserName: '',
    UserEmail: '',
    CommitMessage: '',
    FullCommitMessage: '',
    TagName: '',
    TagMessage: '',
    DisableNoJekyll: false,
    CNAME: '',
    ExcludeAssets: '',
    SshProxy: ''
  });

  const getAllCallParamsByFirstParam = (mockFunc: jest.Mock, firstParam: string) =>
    mockFunc.mock.calls.filter(c => {
      return c[0].indexOf(firstParam) !== -1;
    });

  beforeEach(() => {
    jest.resetModules();
  });

  test('return correct repo address', async () => {
    const inps: Inputs = createInputs();
    const test = await setSSHKey(inps, 'github.com/owner/repo');
    expect(test).toMatch('git@github.com:owner/repo.git');
  });

  test('set known_hosts with the ssh-keyscan output if it succeeded', async () => {
    const inps: Inputs = createInputs();
    await setSSHKey(inps, 'github.com/owner/repo');

    const mockGetExecOutput = await exec.getExecOutput('');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('known_hosts'),
      mockGetExecOutput.stderr + mockGetExecOutput.stdout
    );
  });

  test('write host information on config file', async () => {
    const inps: Inputs = createInputs();
    await setSSHKey(inps, 'github.com/owner/repo');

    const configWriteCallParams = getAllCallParamsByFirstParam(
      fs.writeFileSync as jest.Mock,
      'config'
    );
    expect(configWriteCallParams.length).toBe(1);
    const configParam = configWriteCallParams[0][1];
    expect(configParam).toContain('Host github.com');
    expect(configParam).toContain('HostName github.com');
    expect(configParam).not.toContain('Port');
  });

  test('SSH key fallbacks to default value if ssh-keyscan fails', async () => {
    const inps: Inputs = createInputs();
    (exec.getExecOutput as jest.Mock).mockImplementationOnce(() => {
      throw new Error('error');
    });

    await setSSHKey(inps, 'github.com/owner/repo');

    const knownHostWriteCallParams = getAllCallParamsByFirstParam(
      fs.writeFileSync as jest.Mock,
      'known_hosts'
    );
    expect(knownHostWriteCallParams.length).toBe(1);
    const param = knownHostWriteCallParams[0][1];
    expect(param).toContain('# github.com:22 SSH-2.0-babeld-1f0633a6');
    expect(param).toContain('github.com ssh-rsa AAAAB3NzaC1yc');
  });

  test('invokes ssh-keyscan to ssh proxy address if ssh_proxy is given', async () => {
    const inps: Inputs = {
      ...createInputs(),
      SshProxy: 'ssh.github.com'
    };

    await setSSHKey(inps, 'github.com/owner/repo');

    const sshKeyscanCallParams = getAllCallParamsByFirstParam(
      exec.getExecOutput as jest.Mock,
      'ssh-keyscan'
    );
    expect(sshKeyscanCallParams.length).toBe(1);
    const keyScanParam = sshKeyscanCallParams[0][1];
    expect(keyScanParam).toEqual(['-t', 'rsa', 'ssh.github.com']);
  });

  test('write ssh proxy hostname on config file if ssh_proxy is given', async () => {
    const inps: Inputs = {
      ...createInputs(),
      SshProxy: 'ssh.github.com'
    };

    await setSSHKey(inps, 'github.com/owner/repo');

    const configWriteCallParams = getAllCallParamsByFirstParam(
      fs.writeFileSync as jest.Mock,
      'config'
    );
    expect(configWriteCallParams.length).toBe(1);
    const configParam = configWriteCallParams[0][1];
    expect(configParam).toContain('Host github.com');
    expect(configParam).toContain('HostName ssh.github.com');
  });

  test('write ssh proxy port on config file if ssh_proxy is given with port', async () => {
    const inps: Inputs = {
      ...createInputs(),
      SshProxy: 'ssh.github.com:9999'
    };

    await setSSHKey(inps, 'github.com/owner/repo');

    const configWriteCallParams = getAllCallParamsByFirstParam(
      fs.writeFileSync as jest.Mock,
      'config'
    );
    expect(configWriteCallParams.length).toBe(1);
    const configParam = configWriteCallParams[0][1];
    expect(configParam).toContain('Port 9999');
  });
});

describe('getPublishRepo()', () => {
  test('return repository address', () => {
    const test = getPublishRepo('', 'https://github.com', 'owner', 'repo');
    expect(test).toEqual('github.com/owner/repo');
  });

  test('return correct repository address whent the default server address has a trailing slash', () => {
    const test = getPublishRepo('', 'https://github.com/', 'owner', 'repo');
    expect(test).toEqual('github.com/owner/repo');
  });

  test('return correct repository address whent the default server does not have protocol information', () => {
    const test = getPublishRepo('', 'github.com', 'owner', 'repo');
    expect(test).toEqual('github.com/owner/repo');
  });

  test('return external repository address', () => {
    const test = getPublishRepo('extOwner/extRepo', 'https://github.com', 'owner', 'repo');
    expect(test).toEqual('github.com/extOwner/extRepo');
  });

  test('return correct external repository address when a host address is given', () => {
    const test = getPublishRepo(
      'https://github.enterprise.server/extOwner/extRepo',
      'https://github.com',
      'owner',
      'repo'
    );
    expect(test).toEqual(`github.enterprise.server/extOwner/extRepo`);
  });

  test('return correct external repository even if there is no protocol info', () => {
    const test = getPublishRepo(
      'github.enterprise.server/extOwner/extRepo',
      'https://github.com',
      'owner',
      'repo'
    );
    expect(test).toEqual('github.enterprise.server/extOwner/extRepo');
  });
});

describe('setGithubToken()', () => {
  test('return remote url with GITHUB_TOKEN gh-pages', () => {
    const expected = 'https://x-access-token:GITHUB_TOKEN@github.com/owner/repo.git';
    const test = setGithubToken(
      'GITHUB_TOKEN',
      'github.com/owner/repo',
      'gh-pages',
      '',
      'refs/heads/master',
      'push'
    );
    expect(test).toMatch(expected);
  });

  test('return remote url with GITHUB_TOKEN master', () => {
    const expected = 'https://x-access-token:GITHUB_TOKEN@github.com/owner/repo.git';
    const test = setGithubToken(
      'GITHUB_TOKEN',
      'github.com/owner/repo',
      'master',
      '',
      'refs/heads/source',
      'push'
    );
    expect(test).toMatch(expected);
  });

  test('return remote url with GITHUB_TOKEN gh-pages (RegExp)', () => {
    const expected = 'https://x-access-token:GITHUB_TOKEN@github.com/owner/repo.git';
    const test = setGithubToken(
      'GITHUB_TOKEN',
      'github.com/owner/repo',
      'gh-pages',
      '',
      'refs/heads/gh-pages-base',
      'push'
    );
    expect(test).toMatch(expected);
  });

  test('throw error gh-pages-base to gh-pages-base (RegExp)', () => {
    expect(() => {
      setGithubToken(
        'GITHUB_TOKEN',
        'github.com/owner/repo',
        'gh-pages-base',
        '',
        'refs/heads/gh-pages-base',
        'push'
      );
    }).toThrowError('You deploy from gh-pages-base to gh-pages-base');
  });

  test('throw error master to master', () => {
    expect(() => {
      setGithubToken(
        'GITHUB_TOKEN',
        'github.com/owner/repo',
        'master',
        '',
        'refs/heads/master',
        'push'
      );
    }).toThrowError('You deploy from master to master');
  });

  test('throw error external repository with GITHUB_TOKEN', () => {
    expect(() => {
      setGithubToken(
        'GITHUB_TOKEN',
        'github.com/owner/repo',
        'gh-pages',
        'extOwner/extRepo',
        'refs/heads/master',
        'push'
      );
    }).toThrowError(`\
The generated GITHUB_TOKEN (github_token) does not support to push to an external repository.
Use deploy_key or personal_token.
`);
  });

  test('return remote url with GITHUB_TOKEN pull_request', () => {
    const expected = 'https://x-access-token:GITHUB_TOKEN@github.com/owner/repo.git';
    const test = setGithubToken(
      'GITHUB_TOKEN',
      'github.com/owner/repo',
      'gh-pages',
      '',
      'refs/pull/29/merge',
      'pull_request'
    );
    expect(test).toMatch(expected);
  });
});

describe('setPersonalToken()', () => {
  test('return remote url with personal access token', () => {
    const expected = 'https://x-access-token:pat@github.com/owner/repo.git';
    const test = setPersonalToken('pat', 'github.com/owner/repo');
    expect(test).toMatch(expected);
  });
});
