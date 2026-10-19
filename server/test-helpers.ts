import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { apiRouter, setSafetyBackupDir, getRawSafetyBackupDir } from './api.js';
import { setDbInstance, getDbInstance, runMigrations, setTestMode, getTestMode } from './db.js';

export interface TestServerContext {
  baseUrl: string;
  db: DatabaseSync;
  dbPath: string;
  backupDir: string;
}

/**
 * NOTA DE ARQUITETURA E CONCORRÊNCIA:
 * O sistema utiliza referências globais de processo/módulo para o banco de dados ativo (setDbInstance),
 * o diretório de backups de segurança (setSafetyBackupDir) e flags de ambiente de teste (setTestMode).
 * Como essas referências são singulares e estáticas no processo Node.js, execuções concorrentes ou
 * paralelas de testes causariam interferência mútua no estado global compartilhado.
 *
 * Para evitar race conditions e manter isolamento hermético entre cada cenário de teste sem exigir uma
 * refatoração ampla no core da aplicação, `withTestServer` serializa estritamente as execuções através
 * de uma fila de execução assíncrona (mutex/lock encadeado).
 */
let executionQueue: Promise<void> = Promise.resolve();

/**
 * Utilitário padrão para isolamento estrito de testes HTTP e banco de dados.
 * - Captura o estado global anterior (db, backupDir, testMode) antes de qualquer modificação.
 * - Toda a preparação (criação do arquivo SQLite, WAL, migrações, diretório temporário, Express e listen)
 *   ocorre sob uma estrutura segura que garante rollback e limpeza mesmo se a preparação falhar.
 * - Fecha estritamente os recursos criados pelo teste sem tocar em instâncias prévias.
 * - Remove arquivos temporários (.sqlite, -wal, -shm e diretório temporário de backups).
 * - Restaura fielmente o estado global prévio.
 * - Preserva a causa primária de falha do teste caso a limpeza também gere erros.
 */
export async function withTestServer(
  testFn: (ctx: TestServerContext) => Promise<void>
): Promise<void> {
  const previousTurn = executionQueue;
  let releaseTurn: () => void = () => {};
  executionQueue = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });

  await previousTurn;

  try {
    await runIsolatedTestServer(testFn);
  } finally {
    releaseTurn();
  }
}

async function runIsolatedTestServer(
  testFn: (ctx: TestServerContext) => Promise<void>
): Promise<void> {
  // 1. Captura integral do estado global anterior
  const prevDb = getDbInstance();
  const prevSafetyDir = getRawSafetyBackupDir();
  const prevTestMode = getTestMode();

  let dbPath: string | null = null;
  let db: DatabaseSync | null = null;
  let testBackupDir: string | null = null;
  let server: any = null;
  let primaryError: unknown = null;

  try {
    // 2. Preparação dos recursos com isolamento e salvaguarda imediata
    dbPath = path.resolve('/tmp', `test_${crypto.randomUUID()}.sqlite`);
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);

    setDbInstance(db);

    testBackupDir = path.resolve('/tmp', `safety_test_backups_${crypto.randomUUID()}`);
    fs.mkdirSync(testBackupDir, { recursive: true });
    setSafetyBackupDir(testBackupDir);

    const app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/api', apiRouter);

    server = await new Promise<any>((resolve, reject) => {
      let settled = false;
      try {
        const s = app.listen(0, () => {
          if (!settled) {
            settled = true;
            resolve(s);
          }
        });
        s.once('error', (err: any) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      } catch (listenErr) {
        if (!settled) {
          settled = true;
          reject(listenErr);
        }
      }
    });

    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api`;

    // 3. Execução do teste fornecendo o contexto temporário exclusivo
    await testFn({ baseUrl, db, dbPath, backupDir: testBackupDir });
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    // 4. Limpeza rigorosa e restauração de estado preservando a causa original em caso de falha
    const cleanupErrors: unknown[] = [];

    // Fechar servidor HTTP
    if (server) {
      try {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      } catch (srvCloseErr) {
        cleanupErrors.push(srvCloseErr);
        console.error('[CLEANUP ERROR] Falha ao fechar servidor HTTP de teste:', srvCloseErr);
      }
    }

    // Restaurar estado global anterior (sem fechar recursos que pertenciam a outro contexto)
    try {
      setDbInstance(prevDb);
    } catch (setDbErr) {
      cleanupErrors.push(setDbErr);
      console.error('[CLEANUP ERROR] Falha ao restaurar dbInstance:', setDbErr);
    }

    try {
      setSafetyBackupDir(prevSafetyDir);
    } catch (setDirErr) {
      cleanupErrors.push(setDirErr);
      console.error('[CLEANUP ERROR] Falha ao restaurar safetyBackupDir:', setDirErr);
    }

    try {
      setTestMode(prevTestMode);
    } catch (setModeErr) {
      cleanupErrors.push(setModeErr);
      console.error('[CLEANUP ERROR] Falha ao restaurar testMode:', setModeErr);
    }

    // Fechar banco de dados criado por este teste
    if (db) {
      try {
        db.close();
      } catch (dbCloseErr) {
        cleanupErrors.push(dbCloseErr);
        console.error('[CLEANUP ERROR] Falha ao fechar SQLite de teste:', dbCloseErr);
      }
    }

    // Remover arquivos temporários do SQLite
    if (dbPath) {
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        const walPath = `${dbPath}-wal`;
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        const shmPath = `${dbPath}-shm`;
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
      } catch (unlinkErr) {
        cleanupErrors.push(unlinkErr);
        console.error('[CLEANUP ERROR] Falha ao remover arquivos SQLite temporários:', unlinkErr);
      }
    }

    // Remover diretório temporário de backups de segurança
    if (testBackupDir) {
      try {
        if (fs.existsSync(testBackupDir)) {
          fs.rmSync(testBackupDir, { recursive: true, force: true });
        }
      } catch (rmDirErr) {
        cleanupErrors.push(rmDirErr);
        console.error('[CLEANUP ERROR] Falha ao remover diretório temporário de backups:', rmDirErr);
      }
    }

    // Se a limpeza falhou mas o teste principal passou, lançar erro informando a limpeza
    if (!primaryError && cleanupErrors.length > 0) {
      throw new Error(
        `Erro(s) na limpeza de recursos de teste: ${cleanupErrors
          .map((e) => (e as any)?.message || String(e))
          .join('; ')}`
      );
    }
  }
}
