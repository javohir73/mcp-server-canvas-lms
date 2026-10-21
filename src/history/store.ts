import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

const timestamp = z.iso.datetime();
const assignment = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().max(512),
  due: timestamp.nullable(),
});
const work = z.strictObject({
  checked: timestamp,
  items: z.array(assignment).max(100_000),
});
const news = z.strictObject({
  checked: timestamp,
  ids: z.array(z.number().int().positive()).max(100_000),
});
const schema = z.strictObject({
  version: z.literal(1),
  courses: z.record(
    z.string().regex(/^\d+$/),
    z.strictObject({
      assignments: work.optional(),
      announcements: news.optional(),
    }),
  ),
});
export type History = z.infer<typeof schema>;
export type AssignmentHistory = z.infer<typeof assignment>;
const MAX_BYTES = 8 * 1024 * 1024;

export class HistoryError extends Error {
  constructor(readonly reason: 'busy' | 'read' | 'write' | 'clock') {
    super('Local change history is unavailable.');
  }
}

export function defaultHistoryDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.CANVAS_STATE_DIR) {
    if (!isAbsolute(env.CANVAS_STATE_DIR)) throw new HistoryError('write');
    return env.CANVAS_STATE_DIR;
  }
  if (process.platform === 'darwin')
    return join(
      homedir(),
      'Library',
      'Application Support',
      'mcp-server-canvas-lms',
      'history',
    );
  if (process.platform === 'win32')
    return join(
      env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'mcp-server-canvas-lms',
      'history',
    );
  const base =
    env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : join(homedir(), '.local', 'state');
  return join(base, 'mcp-server-canvas-lms', 'history');
}

/** Serialise checks across clients/processes; never store a token as identity. */
export async function withHistory<T>(
  directory: string,
  origin: string,
  userId: number,
  operation: (history: History) => Promise<{ history: History; result: T }>,
): Promise<T> {
  const key = createHash('sha256')
    .update(`${origin}\n${String(userId)}`)
    .digest('hex');
  const path = join(directory, `${key}.json`);
  const lockPath = join(directory, `${key}.lock`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory())
      throw new Error('Invalid history directory');
  } catch {
    throw new HistoryError('write');
  }
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    throw new HistoryError(code(error) === 'EEXIST' ? 'busy' : 'write');
  }
  const temporary = join(directory, `${key}.${randomUUID()}.tmp`);
  try {
    let history: History = { version: 1, courses: {} };
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > MAX_BYTES)
        throw new Error('Invalid history file');
      history = schema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if (code(error) !== 'ENOENT') throw new HistoryError('read');
    }
    const update = await operation(history);
    try {
      const serialised = JSON.stringify(schema.parse(update.history));
      if (Buffer.byteLength(serialised) > MAX_BYTES)
        throw new Error('History limit reached');
      await writeFile(temporary, serialised, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } catch {
      throw new HistoryError('write');
    }
    return update.result;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

function code(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
