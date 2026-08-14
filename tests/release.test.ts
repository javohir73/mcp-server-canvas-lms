import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');

async function readWorkflow(name: string): Promise<string> {
  return readFile(resolve(projectRoot, '.github', 'workflows', name), 'utf8');
}

describe('GitHub Actions release policy', () => {
  test('package metadata defaults public publishes to provenance', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
    ) as { readonly publishConfig?: unknown };

    expect(packageJson.publishConfig).toEqual({
      access: 'public',
      provenance: true,
    });
  });

  test('CI verifies pull requests and pushes to main on every supported Node line', async () => {
    const workflow = await readWorkflow('ci.yml');

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/push:\s*\n\s+branches:\s*\[main\]/);
    for (const version of ['20.19.x', '22.x', '24.x']) {
      expect(workflow).toContain(version);
    }
  });

  test('CI runs the complete verification suite', async () => {
    const workflow = await readWorkflow('ci.yml');

    for (const command of [
      'npm ci',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'npm pack --dry-run',
    ]) {
      expect(workflow).toContain(`run: ${command}`);
    }
  });

  test('release is tag-only, least-privileged, fully verified, and provenance-enabled', async () => {
    const workflow = await readWorkflow('release.yml');

    expect(workflow).toMatch(/push:\s*\n\s+tags:\s*\['v\*\.\*\.\*'\]/);
    expect(workflow).not.toMatch(/branches:/);
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('registry-url: https://registry.npmjs.org');
    expect(workflow).toContain(
      `run: node -e "const p=require('./package.json'); const tag=process.env.GITHUB_REF_NAME; if (tag !== 'v'+p.version) process.exit(1)"`,
    );

    for (const command of [
      'npm ci',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'npm pack --dry-run',
      'npm publish --provenance --access public',
    ]) {
      expect(workflow).toContain(`run: ${command}`);
    }
  });

  test('all actions use immutable commits with version comments', async () => {
    const workflows = await Promise.all([
      readWorkflow('ci.yml'),
      readWorkflow('release.yml'),
    ]);

    const actionReferences = workflows.flatMap((workflow) =>
      workflow
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('uses:')),
    );

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(
        /^uses: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40} # v\d+(?:\.\d+){1,2}$/,
      );
    }
  });

  test('workflows contain no token secret, privileged PR trigger, or mutable action tag', async () => {
    const workflows = (
      await Promise.all([readWorkflow('ci.yml'), readWorkflow('release.yml')])
    ).join('\n');

    expect(workflows).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(workflows).not.toMatch(/npm_[A-Za-z0-9]{20,}/);
    expect(workflows).not.toContain('pull_request_target');
    expect(workflows).not.toMatch(/^\s*uses:\s+[^\s]+@v\d+/m);
  });

  test('Dependabot checks npm and GitHub Actions weekly without auto-merge configuration', async () => {
    const config = await readFile(
      resolve(projectRoot, '.github', 'dependabot.yml'),
      'utf8',
    );

    expect(config).toContain('package-ecosystem: npm');
    expect(config).toContain('package-ecosystem: github-actions');
    expect(config.match(/interval: weekly/g)).toHaveLength(2);
    expect(config).not.toMatch(/auto-?merge|merge-method/i);
  });
});
