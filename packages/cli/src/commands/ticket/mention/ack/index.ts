import { makeStatusCommand } from '../_shared.ts';

export default makeStatusCommand({
  name: 'ack',
  status: 'acknowledged',
  description: 'Acknowledge a mention (ack <ticket> <mention>)',
  pastTense: 'Acknowledged',
});
