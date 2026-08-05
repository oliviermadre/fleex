import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RoutineRepoPicker } from './RoutineRepoPicker';
import { useRepositoryStore } from '../../stores/repositoryStore';

const repo = (org: string, name: string) => ({ org, name }) as never;

describe('RoutineRepoPicker', () => {
  beforeEach(() => {
    useRepositoryStore.setState({
      repositories: [repo('oliviermadre', 'fleex'), repo('acme', 'api')],
      fetchRepositories: vi.fn(async () => {}),
    } as never);
  });
  afterEach(() => cleanup());

  // WHY: this is the bug that made routines run with an empty workspace. The
  // previous free-text tag input only committed on Enter/space/comma, so a
  // typed-then-submitted `org/name` was dropped and the run got no worktree.
  // Selecting emits the ref immediately — there is no uncommitted state left.
  it('emits the canonical org/name ref as soon as a repo is picked', () => {
    const onChange = vi.fn();
    render(<RoutineRepoPicker value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Add repository'), {
      target: { value: 'oliviermadre/fleex' },
    });
    expect(onChange).toHaveBeenCalledWith(['oliviermadre/fleex']);
  });

  it('offers only repos that are not already selected, and can remove one', () => {
    const onChange = vi.fn();
    render(<RoutineRepoPicker value={['acme/api']} onChange={onChange} />);
    const options = [...screen.getByLabelText('Add repository').querySelectorAll('option')]
      .map((o) => o.value)
      .filter(Boolean);
    expect(options).toEqual(['oliviermadre/fleex']);

    fireEvent.click(screen.getByLabelText('Remove acme/api'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('tells the user where to add repos when none are tracked', () => {
    useRepositoryStore.setState({ repositories: [] } as never);
    render(<RoutineRepoPicker value={[]} onChange={() => {}} />);
    expect(screen.queryByLabelText('Add repository')).toBeNull();
    expect(screen.getByText(/No repositories tracked/)).toBeTruthy();
  });
});
