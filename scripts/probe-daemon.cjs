// Query the running daemon directly to see what it reports for the rule
// that supposedly shows the Aborted() error.
const net = require('node:net');
const fs = require('node:fs');

const DAEMON_DESCRIPTOR = '/var/folders/p2/dyxgdq9959zb_l54gtzxm8lm0000gn/T/codepol-501/daemon.info.json';
const descriptor = JSON.parse(fs.readFileSync(DAEMON_DESCRIPTOR, 'utf8'));
const socketPath = descriptor.transport.path;
console.error('[probe] connecting to', socketPath, 'pid=', descriptor.pid);

const socket = net.createConnection(socketPath);
let buf = Buffer.alloc(0);
let requestId = 0;
const pending = new Map();

socket.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const nl = buf.indexOf(0x0a);
    if (nl === -1) break;
    const line = buf.subarray(0, nl).toString('utf8');
    buf = buf.subarray(nl + 1);
    try {
      const msg = JSON.parse(line);
      const pend = pending.get(msg.id);
      if (pend) {
        pending.delete(msg.id);
        pend.resolve(msg);
      }
    } catch (err) {
      console.error('[probe] bad msg:', line.slice(0, 100));
    }
  }
});

socket.on('error', (err) => console.error('[probe] socket error:', err.message));
socket.on('close', () => console.error('[probe] socket closed'));

function request(type, extra = {}) {
  const id = `probe-${++requestId}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.write(JSON.stringify({ id, type, ...extra }) + '\n');
  });
}

(async () => {
  await new Promise((r) => socket.once('connect', r));
  console.error('[probe] connected');

  const hello = await request('hello', {
    client: {
      kind: 'lsp',
      clientVersion: 'probe-1.0.0',
      instanceId: `probe-${process.pid}`,
      supportedProtocols: ['0.1'],
      supportsFallbackModes: [],
    },
  });
  console.error('[probe] hello:', JSON.stringify(hello).slice(0, 300));

  const register = await request('register_client_session', {
    clientKind: 'lsp',
    clientInstanceId: `probe-${process.pid}`,
  });
  console.error('[probe] register:', JSON.stringify(register).slice(0, 300));
  const clientSessionId = register.clientSessionId;
  const daemonSessionId = register.daemonSessionId;

  const attach = await request('attach_workspace', {
    clientSessionId,
    daemonSessionId,
    rootPath: '/Users/audreysantoso/github/fruitiecutiepie/codepol',
    configPath: 'codepol.toml',
  });
  console.error('[probe] attach:', JSON.stringify(attach).slice(0, 300));

  const replay = await request('complete_replay', {
    clientSessionId,
    daemonSessionId,
    workspaceId: attach.workspaceId,
    workspaceInstanceId: attach.workspaceInstanceId,
  });
  console.error('[probe] replay:', JSON.stringify(replay).slice(0, 300));

  const rules = await request('query_lint_rules', {
    clientSessionId,
    daemonSessionId,
    workspaceId: attach.workspaceId,
    workspaceInstanceId: attach.workspaceInstanceId,
    requestId: 'qr1',
  });
  console.error('[probe] rules raw response:', JSON.stringify(rules).slice(0, 400));

  const rulesList = rules.result?.rules ?? [];
  console.error(`[probe] ${rulesList.length} rules returned; rules with analyzerIssues:`);
  for (const r of rulesList) {
    if ((r.analyzerIssues ?? []).length > 0) {
      console.error(`  - ${r.ruleId}: issues=${JSON.stringify(r.analyzerIssues)}`);
    }
  }

  // Probe the forbidden-declarations rule (likely the one showing the error).
  const details = await request('query_lint_rule_details', {
    clientSessionId,
    daemonSessionId,
    workspaceId: attach.workspaceId,
    workspaceInstanceId: attach.workspaceInstanceId,
    ruleId: '@codepol/plugin/forbidden-declarations',
    requestId: 'qrd1',
  });
  console.error('[probe] forbidden-declarations analyzerIssues:',
    JSON.stringify(details.result?.rule?.analyzerIssues ?? 'NOT-RETURNED', null, 2));
  console.error('[probe] forbidden-declarations totalDiagnosticCount:',
    details.result?.totalDiagnosticCount);

  socket.end();
  process.exit(0);
})().catch((err) => {
  console.error('[probe] fatal:', err?.stack || err);
  process.exit(1);
});
