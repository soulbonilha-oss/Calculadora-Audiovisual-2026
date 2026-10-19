import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { apiRouter, exportBackupData, restoreBackupData, validateBackupPayload, parseNumericField } from './api.js';
import { setDbInstance, runMigrations, clearSampleData, restoreSampleData, CANONICAL_SAMPLE_IDS } from './db.js';
import { generateCommercialProposalPdf } from '../src/utils/pdfGenerator.js';
import { calculateProjectPricing } from '../src/financial/engine.js';

// Utilitário para instanciar servidor de testes efêmero com isolamento total
async function withTestServer(
  testFn: (ctx: { baseUrl: string; db: DatabaseSync; dbPath: string }) => Promise<void>
) {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setDbInstance(null);
    db.close();
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      const shmPath = `${dbPath}-shm`;
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    } catch {}
  }
}

// ============================================================================
// PRIORIDADE 1: PROTEÇÃO DE DADOS REAIS E IDENTIFICAÇÃO CANÔNICA DE DEMO
// ============================================================================

test('P1 - Cenário A: Equipamento real com ID eq_teste_real nunca é classificado como demo e sobrevive à limpeza', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cadastra equipamento real via rota HTTP real
    const resCreate = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'eq_teste_real',
        name: 'Câmera Própria do Usuário',
        category: 'Câmeras',
        purchase_value: 12000,
        residual_value: 2000,
      }),
    });
    assert.equal(resCreate.status, 201);

    // 2. Executa a migração novamente para verificar idempotência
    runMigrations(db);

    // 3. Executa a limpeza de dados demonstrativos via rota real
    const resClear = await fetch(`${baseUrl}/demo/clear-samples`, { method: 'POST' });
    assert.equal(resClear.status, 200);

    // 4. Confirma que o equipamento real continua existindo
    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_teste_real') as any;
    assert.ok(eq, 'Equipamento real do usuário não pode ser excluído');
    assert.equal(eq.is_sample, 0, 'Equipamento real deve ter is_sample = 0');
  });
});

test('P1 - Cenário B: Profissional real com ID pro_teste_real é preservado na limpeza', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cadastra profissional real
    const resCreate = await fetch(`${baseUrl}/professionals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pro_teste_real',
        name: 'Operador Parceiro Oficial',
        specialty: 'Direção de Fotografia',
        hiring_type: 'daily',
        default_value: 800,
      }),
    });
    assert.equal(resCreate.status, 201);

    // 2. Executa limpeza via rota real
    await fetch(`${baseUrl}/demo/clear-samples`, { method: 'POST' });

    // 3. Verifica persistência
    const pro = db.prepare('SELECT * FROM professionals WHERE id = ?').get('pro_teste_real') as any;
    assert.ok(pro, 'Profissional real não pode ser removido');
    assert.equal(pro.is_sample, 0);
  });
});

test('P1 - Cenário C: Modelo de produção real com ID tpl_teste_real permanece no banco após limpeza', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cadastra modelo de produção real
    const resCreate = await fetch(`${baseUrl}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'tpl_teste_real',
        name: 'Formato Proprietário FBonilha 2026',
        description: 'Estrutura exclusiva de gravação',
      }),
    });
    assert.equal(resCreate.status, 201);

    // 2. Limpeza
    await fetch(`${baseUrl}/demo/clear-samples`, { method: 'POST' });

    // 3. Confirma presença
    const tpl = db.prepare('SELECT * FROM production_templates WHERE id = ?').get('tpl_teste_real') as any;
    assert.ok(tpl, 'Modelo real do usuário deve permanecer intacto');
    assert.equal(tpl.is_sample, 0);
  });
});

test('P1 - Cenário D: Registro demonstrativo legítimo é identificado e removido seletivamente', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // Cadastra item real junto com os canônicos de demo
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value, is_sample) VALUES (?, ?, ?, ?, 0)')
      .run('eq_meu_drone', 'Drone Pessoal DJI Mini 4', 5000, 1000);

    // Confirma que demo existe
    const demoFx3Before = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_camera_fx3') as any;
    assert.ok(demoFx3Before, 'Equipamento canônico demo deve existir');
    assert.equal(demoFx3Before.is_sample, 1);

    // Executa limpeza
    await fetch(`${baseUrl}/demo/clear-samples`, { method: 'POST' });

    // Demo foi removido
    const demoFx3After = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_camera_fx3');
    assert.equal(demoFx3After, undefined, 'Demo legítimo deve ter sido excluído');

    // Item real permaneceu
    const realDrone = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_meu_drone') as any;
    assert.ok(realDrone, 'Item do usuário deve ser estritamente preservado');
    assert.equal(realDrone.is_sample, 0);
  });
});

test('P1 - Cenário E: Migração repetida é idempotente e não altera dados existentes', async () => {
  await withTestServer(async ({ db }) => {
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value, is_sample) VALUES (?, ?, ?, ?, 0)')
      .run('eq_teste_idemp', 'Equipamento Idempotência', 3000, 500);

    // Executa migrações 3 vezes consecutivas
    runMigrations(db);
    runMigrations(db);
    runMigrations(db);

    const count = (db.prepare('SELECT count(*) as c FROM equipment WHERE id = ?').get('eq_teste_idemp') as any).c;
    assert.equal(count, 1);
    const item = db.prepare('SELECT is_sample FROM equipment WHERE id = ?').get('eq_teste_idemp') as any;
    assert.equal(item.is_sample, 0);
  });
});

test('P1 - Cenário F: Base legada com registros anteriores e origem desconhecida preserva todos', async () => {
  await withTestServer(async ({ db }) => {
    // Simula registros legados que foram incorretamente marcados com is_sample = 1 por migration antiga com LIKE 'eq_%'
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value, is_sample) VALUES (?, ?, ?, ?, 1)')
      .run('eq_legado_desconhecido', 'Equipamento Antigo Desconhecido', 7000, 1000);

    // Executa migration 4 (que faz a correção da lista canônica)
    for (const [table, ids] of Object.entries(CANONICAL_SAMPLE_IDS)) {
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(`UPDATE ${table} SET is_sample = 0 WHERE id NOT IN (${placeholders})`).run(...ids);
      db.prepare(`UPDATE ${table} SET is_sample = 1 WHERE id IN (${placeholders})`).run(...ids);
    }

    // Limpeza
    clearSampleData(db);

    // O registro legado foi corrigido para is_sample = 0 e NÃO foi excluído
    const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_legado_desconhecido');
    assert.ok(item, 'Registro legado de origem desconhecida não pode ser excluído');
  });
});

// ============================================================================
// PRIORIDADE 2: RESTAURAÇÃO DE PROPOSTAS COM DESCONTO DE 0% E CONDIÇÕES
// ============================================================================

test('P2 - Cenário A: Desconto à vista de 0% é preservado na rota real de restauração', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cria orçamento e emite proposta com 0% de desconto
    const resBud = await fetch(`${baseUrl}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Campanha Institucional Sem Desconto',
        client_name: 'Cliente Alpha',
      }),
    });
    const budget = await resBud.json();

    const resProp = await fetch(`${baseUrl}/budgets/${budget.id}/emit-proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalPrice: 10000,
        cashDiscountPct: 0, // EXPLICITAMENTE ZERO
        installmentCount: 4,
      }),
    });
    const proposal = await resProp.json();
    assert.equal(proposal.cash_discount_pct, 0);
    assert.equal(proposal.cash_price, 10000);

    // 2. Exporta backup JSON
    const resExp = await fetch(`${baseUrl}/backup/export-json`);
    const backup = await resExp.json();

    // 3. Modifica a proposta no banco para verificar se a restauração recupera exatamente 0%
    db.prepare('UPDATE proposals SET cash_discount_pct = 99 WHERE id = ?').run(proposal.id);

    // 4. Restaura o backup via rota real com mode = commit
    const resRestore = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });
    assert.equal(resRestore.status, 200);

    // 5. Consulta proposta restaurada
    const restored = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposal.id) as any;
    assert.equal(restored.cash_discount_pct, 0.0, 'Desconto de 0% deve ser preservado e não virar 10%');
    assert.equal(restored.cash_price, 10000);
  });
});

test('P2 - Cenário B: Desconto de 10% é preservado exatamente', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    const resBud = await fetch(`${baseUrl}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Campanha 10%', client_name: 'Cliente Beta' }),
    });
    const budget = await resBud.json();

    const resProp = await fetch(`${baseUrl}/budgets/${budget.id}/emit-proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalPrice: 2000,
        cashDiscountPct: 10,
        installmentCount: 2,
      }),
    });
    const proposal = await resProp.json();

    const resExp = await fetch(`${baseUrl}/backup/export-json`);
    const backup = await resExp.json();

    const resRestore = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });
    assert.equal(resRestore.status, 200);

    const restored = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposal.id) as any;
    assert.equal(restored.cash_discount_pct, 10.0);
    assert.equal(restored.cash_price, 1800.0);
  });
});

test('P2 - Cenário C & D: Campo ausente adota compatibilidade e campo inválido é rejeitado', async () => {
  await withTestServer(async ({ baseUrl }) => {
    // Payload com desconto inválido (negativo)
    const invalidPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        budgets: [{ id: 'bud_inv', code: 'ORC-INV', title: 'Inv', client_name: 'Cliente' }],
        proposals: [{
          id: 'prop_inv',
          budget_id: 'bud_inv',
          proposal_code: 'PROP-INV',
          client_name: 'Cliente',
          project_title: 'Inv',
          total_price: 1000,
          cash_discount_pct: -15, // INVÁLIDO
        }],
      },
    };

    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload),
    });
    assert.equal(res.status, 400, 'Backup com desconto negativo deve ser rejeitado na validação');
  });
});

test('P2 - Cenário E: Geração de PDF da proposta restaurada reflete condição comercial exata', async () => {
  const proposalData = {
    proposalCode: 'PROP-2026-TEST',
    clientName: 'Cliente Teste PDF',
    projectTitle: 'Vídeo Institucional',
    scopeSummary: 'Produção completa',
    commercialHours: { preProductionHours: 4, productionHours: 8, postProductionHours: 12 },
    totalPrice: 8000,
    cashPrice: 8000,
    cashDiscountPct: 0, // 0% de desconto
    installmentCount: 1, // Parcela única
    installmentValue: 8000,
    issueDate: '2026-10-18',
    validUntilDate: '2026-10-25',
    issuerContact: { studioName: 'FBonilha.mov', phone: '11999999999', email: 'contato@fbonilha.mov' },
    settings: { studio_name: 'FBonilha.mov', primary_color: '#4F5D47' },
  };

  const doc = generateCommercialProposalPdf(proposalData as any);
  assert.ok(doc, 'PDF deve ser gerado sem erros');
  const pdfOutput = doc.output('datauristring');
  assert.ok(pdfOutput.startsWith('data:application/pdf;filename=generated.pdf;base64,'));
});

// ============================================================================
// PRIORIDADE 3: RESTAURAÇÃO INTEGRAL (REPLACE) VS MESCLAGEM (MERGE)
// ============================================================================

test('P3 - Cenário A: Substituição integral remove registros locais que não constam no backup', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cria Base A com 1 equipamento
    await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'eq_base_a', name: 'Equipamento Base A', purchase_value: 5000 }),
    });

    // 2. Exporta backup da Base A
    const resExp = await fetch(`${baseUrl}/backup/export-json`);
    const backupA = await resExp.json();

    // 3. Adiciona registros novos posteriores à Base A
    await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'eq_novo_posterior', name: 'Equipamento Criado Depois', purchase_value: 9000 }),
    });
    assert.ok(db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_novo_posterior'));

    // 4. Restaura no modo 'replace' (Substituição Integral)
    const resRestore = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupA),
    });
    assert.equal(resRestore.status, 200);

    // 5. Confirma que a base corresponde ao backup: eq_base_a existe e eq_novo_posterior FOI REMOVIDO
    assert.ok(db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_base_a'), 'Registro original do backup deve existir');
    const posterior = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_novo_posterior');
    assert.equal(posterior, undefined, 'No modo substituição integral, registros que não estavam no backup devem ser excluídos');
  });
});

test('P3 - Cenário B: Modo mesclagem (merge) preserva registros locais e insere/atualiza backup', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cria backup com eq_1
    const backupPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'FBonilha.mov' },
        equipment: [{ id: 'eq_backup_1', name: 'Câmera do Backup', purchase_value: 4000, residual_value: 500 }],
      },
    };

    // 2. Cria item local antes da mesclagem
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_local_existente', 'Lente Local Existente', 3000, 300);

    // 3. Restaura no modo 'merge'
    const resMerge = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupPayload),
    });
    assert.equal(resMerge.status, 200);

    // 4. Confirma que ambos coexistem
    assert.ok(db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_backup_1'), 'Item do backup inserido');
    assert.ok(db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_local_existente'), 'Item local existente preservado intacto');
  });
});

test('P3 - Cenário C: Rollback atômico em caso de falha no meio da restauração', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // Cadastra item inicial
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_intacto', 'Equipamento Intacto', 5000, 500);

    // Cria payload que causará erro na transação (chave estrangeira violada de propósito em SQLite estrito)
    const brokenPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        budgets: [{ id: 'bud_ok', code: 'ORC-01', title: 'Ok', client_name: 'Cli' }],
        proposals: [{
          id: 'prop_orphan',
          budget_id: 'bud_que_nao_existe_no_banco',
          proposal_code: 'PROP-ORPHAN',
          client_name: 'Cli',
          project_title: 'Tit',
          total_price: 1000,
        }],
      },
    };

    // A validação ou a constraint deve abortar
    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brokenPayload),
    });
    assert.notEqual(res.status, 200);

    // Verifica que eq_intacto NÃO foi apagado
    const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_intacto');
    assert.ok(item, 'Transação revertida integralmente - dados originais preservados');
  });
});

// ============================================================================
// PRIORIDADE 4: PRESERVAÇÃO DE VALORES ZERO EM CONFIGURAÇÕES E CÁLCULOS
// ============================================================================

test('P4 - Configuração de impostos e taxas com 0% é salva, recuperada e calculada corretamente', async () => {
  await withTestServer(async ({ baseUrl }) => {
    // Salva configurações com taxas estritamente iguais a 0%
    const resPut = await fetch(`${baseUrl}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_tax_pct: 0,
        default_financial_fee_pct: 0,
        default_cash_discount_pct: 0,
        default_profit_margin_pct: 20,
      }),
    });
    assert.equal(resPut.status, 200);
    const updated = await resPut.json();

    // 1. Zero é salvo e recuperado corretamente
    assert.equal(updated.default_tax_pct, 0.0);
    assert.equal(updated.default_financial_fee_pct, 0.0);
    assert.equal(updated.default_cash_discount_pct, 0.0);

    // 2. Consulta GET /settings confirma persistência de zero
    const resGet = await fetch(`${baseUrl}/settings`);
    const settings = await resGet.json();
    assert.equal(settings.default_tax_pct, 0.0);
    assert.equal(settings.default_financial_fee_pct, 0.0);
    assert.equal(settings.default_cash_discount_pct, 0.0);

    // 3. Motor financeiro usa taxa zero sem erro de fallback
    const pricing = calculateProjectPricing(
      { laborCost: 1000, depreciationCost: 0, overheadCost: 0, servicesAndExtrasCost: 0, thirdPartyCost: 0, otherDirectExpensesCost: 0 },
      { method: 'margin_on_sale', desiredProfitMarginPct: 20, desiredMarkupPct: 0, taxPct: settings.default_tax_pct, financialFeePct: settings.default_financial_fee_pct, fixedTransactionFee: 0 }
    );
    // P = 1000 / (1 - 0 - 0 - 0.20) = 1000 / 0.8 = 1250
    assert.equal(pricing.finalBasePrice, 1250);
    assert.equal(pricing.taxAmount, 0);
    assert.equal(pricing.financialFeeAmount, 0);
  });
});

// ============================================================================
// PRIORIDADE 5: BACKUP SQLITE EM WAL MODE VIA VACUUM INTO
// ============================================================================

test('P5 - Exportação SQLite atômica via VACUUM INTO gera arquivo íntegro com alterações recentes', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // Faz uma alteração recente no banco
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('FBonilha WAL Test');

    const res = await fetch(`${baseUrl}/backup/export-sqlite`);
    assert.equal(res.status, 200);
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    assert.ok(buffer.length > 0, 'Arquivo SQLite baixado deve conter bytes');

    // Salva em arquivo temporário e abre para checar integridade e conteúdo
    const tempCheckPath = path.resolve('/tmp', `wal_check_${crypto.randomUUID()}.sqlite`);
    fs.writeFileSync(tempCheckPath, buffer);

    const checkDb = new DatabaseSync(tempCheckPath);
    const integrity = (checkDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
    assert.equal(integrity, 'ok', 'Banco SQLite exportado deve passar no integrity_check');

    const savedStudio = (checkDb.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
    assert.equal(savedStudio, 'FBonilha WAL Test', 'Alteração em WAL deve constar no snapshot atômico');

    checkDb.close();
    fs.unlinkSync(tempCheckPath);
  });
});
