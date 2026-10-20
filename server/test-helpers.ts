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
  port: number;
}

/**
 * Mutex assíncrono para serialização estrita de execuções de testes.
 * Garante que:
 * 1. O bloqueio abranja preparação, callback do teste e limpeza.
 * 2. As tarefas sejam estritamente serializadas em fila (FIFO).
 * 3. Falhas ou exceções em uma tarefa anterior nunca travem ou bloqueiem tarefas subsequentes.
 * 4. Toda liberação ocorra em bloco `finally`.
 */
class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.queue;
    this.queue = turn;

    try {
      // Aguarda a execução anterior finalizar, absorvendo eventuais rejeições anteriores
      await previous.catch(() => {});
      return await fn();
    } finally {
      // Garante a liberação do turno mesmo se fn() lançar erro síncrono ou assíncrono
      release();
    }
  }
}

const testServerMutex = new AsyncMutex();

/**
 * Utilitário padrão para isolamento estrito de testes HTTP e banco de dados SQLite.
 *
 * Princípios de segurança e ciclo de vida:
 * - Toda a preparação (criação do arquivo SQLite, WAL, migrações, diretório temporário, Express e listen)
 *   ocorre sob uma estrutura segura que garante rollback e limpeza mesmo se a preparação falhar.
 * - Captura o estado global anterior (dbInstance, safetyBackupDir, testMode) antes de qualquer mutação.
 * - Fecha estritamente os recursos criados pelo teste sem tocar em instâncias prévias pertencentes a outro contexto.
 * - Remove arquivos temporários (.sqlite, -wal, -shm e diretório temporário de backups).
 * - Restaura fielmente o estado global prévio.
 * - Preserva a causa primária de falha do teste, registrando separadamente qualquer erro ocorrido durante a limpeza.
 * - Serializa todas as execuções via AsyncMutex para prevenir concorrência em referências estáticas de processo.
 */
export async function withTestServer(
  testFn: (ctx: TestServerContext) => Promise<void>
): Promise<void> {
  return testServerMutex.runExclusive(async () => {
    // 1. Captura integral do estado global anterior ANTES de qualquer alocação
    const prevDb = getDbInstance();
    const prevSafetyDir = getRawSafetyBackupDir();
    const prevTestMode = getTestMode();

    let dbPath: string | null = null;
    let db: DatabaseSync | null = null;
    let testBackupDir: string | null = null;
    let server: any = null;
    let primaryError: unknown = null;

    try {
      // 2. Preparação de recursos integralmente sob cobertura de try/finally
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
        let s: any = null;
        try {
          s = app.listen(0, () => {
            if (!settled) {
              settled = true;
              resolve(s);
            }
          });
          server = s; // Guarda a referência imediatamente para permitir fechamento garantido em caso de falha posterior
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

      // 3. Execução da função de teste fornecendo o contexto temporário exclusivo
      await testFn({ baseUrl, db, dbPath, backupDir: testBackupDir, port });
    } catch (err) {
      primaryError = err;
      throw err;
    } finally {
      // 4. Limpeza rigorosa e restauração de estado preservando a causa original em caso de falha
      const cleanupErrors: unknown[] = [];

      // Fechar servidor HTTP criado por este teste quando aplicável
      if (server && typeof server.close === 'function') {
        try {
          await new Promise<void>((resolve, reject) => {
            try {
              server.close((err: any) => {
                if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
                else resolve();
              });
            } catch (syncErr: any) {
              if (syncErr && syncErr.code === 'ERR_SERVER_NOT_RUNNING') resolve();
              else reject(syncErr);
            }
          });
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
        for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch (unlinkErr) {
            cleanupErrors.push(unlinkErr);
            console.error('[CLEANUP ERROR] Falha ao remover arquivo SQLite temporário:', f, unlinkErr);
          }
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
  });
}
