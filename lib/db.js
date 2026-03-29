export async function query(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result.results;
}

export async function queryFirst(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).first();
  return result;
}

export async function execute(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).run();
}

export async function batchExecute(db, statements) {
  return await db.batch(statements.map(s => db.prepare(s.sql).bind(...(s.params || []))));
}
