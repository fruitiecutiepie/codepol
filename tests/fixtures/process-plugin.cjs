#!/usr/bin/env node
const fs = require('node:fs');

const PROTOCOL_VERSION = 1;

function respondSuccess(result) {
  process.stdout.write(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    result,
  }));
}

function respondFailure(message) {
  process.stdout.write(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: message,
  }));
}

function violation(rule, context, message) {
  return {
    ruleId: rule.id || rule.ruleId,
    filePath: context.filePath,
    message,
    line: 1,
    column: 1,
  };
}

try {
  const input = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(input);

  if (request.method === 'describe') {
    respondSuccess({
      pluginId: request.pluginId,
      rules: [
        {
          id: 'no-todo-comment',
          languages: ['typescript'],
          hasFixProvider: true,
        },
        {
          id: 'requires-index',
          languages: ['typescript'],
          requiresProjectIndex: true,
        },
        {
          id: 'no-todo-comment-any-language',
        },
      ],
    });
  } else if (request.method === 'check') {
    if (
      request.ruleId === 'no-todo-comment' ||
      request.ruleId === 'no-todo-comment-any-language'
    ) {
      const hasTodo = request.context.source.includes('TODO');
      respondSuccess({
        violations: hasTodo
          ? [violation(request.rule, request.context, 'TODO comment not allowed')]
          : [],
      });
    } else if (request.ruleId === 'requires-index') {
      const snapshot = request.context.projectIndex;
      const hasSnapshot = snapshot && Array.isArray(snapshot.files) && snapshot.files.length > 0;
      respondSuccess({
        violations: hasSnapshot
          ? []
          : [violation(request.rule, request.context, 'Project index snapshot missing')],
      });
    } else {
      respondFailure(`Unknown ruleId: ${request.ruleId}`);
    }
  } else if (request.method === 'fix') {
    if (request.ruleId === 'no-todo-comment') {
      for (const file of request.context.files) {
        const source = fs.readFileSync(file, 'utf8');
        const fixed = source.replace(/TODO\s*/g, '');
        if (fixed !== source) {
          fs.writeFileSync(file, fixed, 'utf8');
        }
      }
      respondSuccess({});
    } else {
      respondSuccess({});
    }
  } else {
    respondFailure(`Unknown method: ${request.method}`);
  }
} catch (error) {
  respondFailure(error instanceof Error ? error.message : String(error));
}
