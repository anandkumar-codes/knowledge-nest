// Runs requests that change data one at a time, in arrival order.
// Database calls are asynchronous (the data may live in Turso), so without this two requests could interleave:
// both check that seat C7 is free, then both book it. Serialising writes keeps the checks and the writes
// together, exactly as when every request ran in one uninterrupted step. Reads still run side by side.
// Sign-ins are left out: they only stamp a last-login time, and their slow password check shouldn't hold others up.
const SKIP = new Set(['/api/auth/login', '/api/portal/login']);
let queue = Promise.resolve();

export function serializeWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || SKIP.has(req.path)) return next();
  let release;
  const turn = new Promise((resolve) => { release = resolve; });
  const previous = queue;
  queue = previous.then(() => turn);
  previous.then(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        release();
      }
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  });
}
