import { describe, it, expect } from 'vitest';
import { enforceRisk, extractBinaries, isDestructiveCommand } from './command-safety.js';

describe('enforceRisk', () => {
  it.each([
    'rm -rf ~/tmp',
    'docker system prune -af --volumes',
    'kubectl --context prod delete pod api-1',
    'git push -f origin main',
    'git push origin main --force',
    'echo x > /etc/hosts',
    'dd if=/dev/zero of=/dev/disk2',
    'rm --recursive ~/project',
    'git branch -D feature/x',
    'git push origin --delete feature/x',
    'git push origin :feature/x',
    'psql -c "DELETE FROM users"',
    'psql -c "truncate table events"',
    'find . -name "*.log" -delete',
    'aws s3 rm s3://bucket/key --recursive',
    'gh repo delete org/repo --yes',
    'echo "export X=1" > ~/.zshrc',
    'kubectl drain node-1 --ignore-daemonsets',
    'kubectl -n prod scale deploy api --replicas=0',
  ])('marks "%s" destructive even when the model says safe', (cmd) => {
    expect(enforceRisk(cmd, 'safe')).toBe('destructive');
  });

  it('keeps the model label for harmless commands', () => {
    expect(enforceRisk('gh auth status', 'safe')).toBe('safe');
    expect(enforceRisk('gcloud auth login', 'mutating')).toBe('mutating');
    expect(isDestructiveCommand('cmd >/dev/null 2>&1')).toBe(false);
  });

  it.each([
    'gh pr view 12',
    'kubectl get pods -n prod',
    'kubectl scale deploy api --replicas=3',
    'git branch -d merged-branch',
    'git push origin main',
    'git push origin HEAD:refs/heads/main',
    'find . -name "*.ts"',
    'aws s3 ls s3://bucket',
    'echo hi >> ~/notes.txt',
    'gh repo view org/repo',
  ])('does not flag "%s"', (cmd) => {
    expect(isDestructiveCommand(cmd)).toBe(false);
  });

  it('defaults an unknown label to mutating rather than safe', () => {
    expect(enforceRisk('platool login prod', undefined)).toBe('mutating');
  });
});

describe('extractBinaries', () => {
  it('takes the first word of each pipeline segment', () => {
    expect(extractBinaries('kubectl --context prod cluster-info >/dev/null 2>&1 && echo ok || jq .')).toEqual(['kubectl', 'jq']);
  });

  it('looks inside $(…) and if/then blocks, skipping keywords, builtins and assignments', () => {
    const probe = `if gh auth status >/dev/null 2>&1; then
  u=$(gh api user -q .login); r=$(curl -s x | jq .)
  printf '%s' "$u"
else echo ko; fi`;
    expect(extractBinaries(probe)).toEqual(['gh', 'curl', 'jq']);
  });

  it('ignores words inside quotes', () => {
    expect(extractBinaries(`echo '{"status":"ok"} && rm'`)).toEqual([]);
    expect(extractBinaries('FOO=1 sudo platool login "a && b"')).toEqual(['platool']);
  });
});
