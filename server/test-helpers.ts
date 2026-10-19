import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { apiRouter } from './api.js';
import { setDbInstance, runMigrations } from './db.js';

export interface TestServerContext {
  baseUrl: string;
  db: DatabaseSync;
  dbPath: string;
}

/**
 * Utilitário padrão para isolamento estrito de testes HTTP e banco de dados.
 * Cria um banco temporário único por execução de teste em /tmp, executa migrações,
 * vincula a instância via setDbInstance e garante limpeza integral de conexões e arquivos
 * (incluindo WAL e SHM), mesmo que o teste falhe com exceção.
 */
export async function withTestServer(
  testFn: (ctx: TestServerContext) => Promise<void>
): Promise<void> {
  const dbPath = path.resolve('/tmp', `test_${crypto.randomUUID()}.sqlite`);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);

  setDbInstance(db);

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', apiRouter);

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await testFn({ baseUrl, db, dbPath });
  } finally {
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {}

    setDbInstance(null);

    try {
      db.close();
    } catch {}

    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      const shmPath = `${dbPath}-shm`;
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    } catch {}
  }
}
