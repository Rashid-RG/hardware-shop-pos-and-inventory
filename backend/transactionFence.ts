// Register only on the main server pool. Independent test pools remain unaffected.
export function installTransactionFence(pool: import('pg').Pool, beforeWrite: () => Promise<void>, acquireFence: (client: import('pg').PoolClient) => Promise<void>) {
  const states = new WeakMap<import('pg').PoolClient, { active: boolean; uncertain: boolean }>();
  pool.on('connect', (client) => {
    const state = { active: false, uncertain: false };
    states.set(client, state);
    const original = client.query.bind(client);
    client.query = ((...args: any[]) => {
      const sql = typeof args[0] === 'string' ? args[0].trim().toUpperCase() : '';
      if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return (original as any)(...args);
      if (args.length !== 1) throw new Error('Unsupported transaction boundary invocation.');
      return (async () => {
        if (sql === 'ROLLBACK') {
          try {
            const result = await original('ROLLBACK');
            state.active = false;
            return result;
          } catch (error) {
            state.uncertain = true;
            throw error;
          }
        }
        if (state.uncertain) throw new Error('Uncertain transaction session must be discarded.');
        if (sql === 'COMMIT') {
          if (!state.active) throw new Error('Commit without admitted transaction.');
          await beforeWrite();
          try {
            const result = await original('COMMIT');
            state.active = false;
            if (result.command !== 'COMMIT') throw new Error('PostgreSQL did not confirm COMMIT.');
            return result;
          } catch (error) {
            state.uncertain = true;
            throw error;
          }
        }
        if (state.active) throw new Error('Nested transaction boundary rejected.');
        state.active = true;
        try {
          const result = await original('BEGIN');
          await acquireFence(client);
          return result;
        } catch (error) {
          try {
            await original('ROLLBACK');
            state.active = false;
          } catch {
            state.uncertain = true;
          }
          throw error;
        }
      })();
    }) as typeof client.query;
  });
  // pg-pool emits acquire before assigning release. Wrap the completed checkout,
  // not the event. Preserve both promise and callback forms used by pool.query.
  const connect = pool.connect.bind(pool);
  const protectRelease = (client: import('pg').PoolClient) => {
    const state = states.get(client);
    if (!state) {
      client.release(true);
      throw new Error('Untracked database pool session.');
    }
    const release = client.release.bind(client);
    client.release = (error?: Error | boolean) => {
      release(error || state.active || state.uncertain || undefined);
    };
    return client;
  };
  pool.connect = ((callback?: (err: Error | undefined, client: import('pg').PoolClient | undefined, release: ((error?: Error | boolean) => void) | undefined) => void) => {
    if (callback) {
      return connect((err, client) => {
        if (err || !client) return callback(err || new Error('Database checkout failed.'), undefined, undefined);
        try { protectRelease(client); }
        catch (error) { return callback(error as Error, undefined, undefined); }
        callback(undefined, client, client.release);
      });
    }
    return connect().then(protectRelease);
  }) as typeof pool.connect;
}
