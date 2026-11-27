import { makeStatusCommand } from '../_shared.ts';

export default makeStatusCommand({
  name: 'resolve',
  access: 'write',
  status: 'resolved',
  description: 'Mark a mention as resolved (resolve <ticket> <mention>)',
  pastTense: 'Resolved',
});
