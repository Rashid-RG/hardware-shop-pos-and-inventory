// Register transaction hooks only on this server's pool. Independent test pools remain unaffected.
export function installTransactionFence(pool: import('pg').Pool, beforeWrite: () => Promise<void>, acquireFence: (client: import('pg').PoolClient) => Promise<void>) {
  pool.on('connect', (client) => {
    const original = client.query.bind(client);
    // pg supports both callback and promise overloads. Preserve callbacks and
    // non-boundary queries; production explicit boundaries use promises.
    client.query = ((...args: any[]) => {
      const sql = typeof args[0] === 'string' ? args[0].trim().toUpperCase() : '';
      if (sql !== 'BEGIN' && sql !== 'COMMIT') return (original as any)(...args);
      if (args.length !== 1) throw new Error('Unsupported transaction boundary invocation.');
      return (async () => {
        if (sql === 'COMMIT') {
          await beforeWrite();
          return original('COMMIT');
        }
        const result = await original('BEGIN');
        try {
          // Acquire using the existing client; the fence itself is not a boundary.
          await acquireFence(client);
          return result;
        } catch (error) {
          await original('ROLLBACK');
          throw error;
        }
      })();
    }) as typeof client.query;
  });
}
