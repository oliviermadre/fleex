import { makeStatusCommand } from '../_shared.ts';

export default makeStatusCommand({
  name: 'ack',
  access: 'write',
  status: 'acknowledged',
  description: 'Acknowledge a mention (ack <ticket> <mention>)',
  pastTense: 'Acknowledged',
});
