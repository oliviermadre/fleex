export interface PipeFunction {
  name: string;
  fn: (value: string, ...args: string[]) => string;
}
