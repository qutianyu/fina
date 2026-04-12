// Library entry point - re-export all public modules
export * from './lib/index';
export { InitCommand } from './commands/init';
export { QueryCommand } from './commands/query';
export { MakeCommand } from './commands/make';
export { AddCommand } from './commands/add';
export { LintCommand, LintIssue } from './commands/lint';
export { MergeCommand } from './commands/merge';
export { StatusCommand } from './commands/status';