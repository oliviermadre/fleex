import { makeStatusCommand } from '../_shared.ts';

export default makeStatusCommand({
  name: 'wait',
  status: 'waiting_for_info',
  description: 'Set a mention to waiting-for-info (wait <ticket> <mention>)',
  pastTense: 'Set waiting-for-info on',
});
