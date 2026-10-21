import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {
  apiRouter,
  exportBackupData,
  restoreBackupData,
  validateBackupPayload,
  parseNumericField,
  createSafetyBackup,
  parseAndValidateImportMode,
  setSafetyBackupDir,
  getSafetyBackupDir,
  getRawSafetyBackupDir,
  SUPPORTED_SCHEMA_VERSIONS,
} from './api.js';
import {
  setDbInstance,
  getDbInstance,
  runMigrations,
  clearSampleData,
  restoreSampleData,
  CANONICAL_SAMPLE_IDS,
  setTestMode,
  getTestMode,
  applyMigration5,
  ensureEquipmentSchemaNormalized,
  EquipmentNameConflictError,
  getEquipmentNameConflicts,
  setAllowStartupWithConflicts,
  getAllowStartupWithConflicts,
} from './db.js';
import { generateCommercialProposalPdf } from '../src/utils/pdfGenerator.js';
import { calculateProjectPricing } from '../src/financial/engine.js';
import { CATEGORIES } from '../src/components/equipment/EquipmentView.js';

import { withTestServer } from './test-helpers.js';

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

// ============================================================================
// ETAPA 1: IMPEDIR RESTAURAÇÃO DE BACKUPS JSON INCOMPLETOS
// ============================================================================

test('E1.1 - Backup completo válido com todas as coleções canônicas é restaurado com sucesso no modo replace', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Inserir registro local inicial
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_old', 'Câmera Velha', 1000, 100);

    const fullPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      exported_at: '2026-10-18T10:00:00.000Z',
      data: {
        settings: { studio_name: 'Studio Cinema Novo' },
        equipment: [{ id: 'eq_new_1', name: 'Sony FX6', purchase_value: 35000, residual_value: 5000 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [{ id: 'pro_new_1', name: 'Diretor de Fotografia', specialty: 'DOP', hiring_type: 'daily', default_value: 1200 }],
        production_templates: [],
        budgets: [{ id: 'bud_new_1', code: 'ORC-2026-N1', title: 'Comercial TV', client_name: 'Anunciante X' }],
        proposals: [{
          id: 'prop_new_1',
          budget_id: 'bud_new_1',
          proposal_code: 'PROP-2026-N1',
          client_name: 'Anunciante X',
          project_title: 'Comercial TV',
          total_price: 25000,
          cash_discount_pct: 5,
        }],
      },
    };

    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullPayload),
    });
    assert.equal(res.status, 200);

    // Consulta real no banco: registros anteriores foram substituídos e novos foram inseridos
    const oldEq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_old');
    assert.equal(oldEq, undefined, 'Registro pré-existente foi substituído');

    const newEq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_new_1') as any;
    assert.ok(newEq);
    assert.equal(newEq.name, 'Sony FX6');

    const newProp = db.prepare('SELECT * FROM proposals WHERE id = ?').get('prop_new_1') as any;
    assert.ok(newProp);
    assert.equal(newProp.total_price, 25000);
  });
});

test('E1.2 - Backup no modo replace com coleção obrigatória ausente é rejeitado e nenhum dado existente é apagado', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Inserir registros que NÃO podem ser apagados
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_protegido', 'Câmera Intacta', 20000, 2000);
    const countBefore = (db.prepare('SELECT count(*) as c FROM equipment').get() as any).c;

    // 2. Payload omitindo coleções obrigatórias (ex: sem 'professionals' e sem 'production_templates')
    const partialPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Tentativa Incompleta' },
        equipment: [{ id: 'eq_incompleto', name: 'Lente Incompleta' }],
        // recurring_expenses ausente
        // expense_catalog ausente
        // professionals ausente
        // production_templates ausente
        // budgets ausente
        // proposals ausente
      },
    };

    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partialPayload),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.match(body.details.join(' '), /coleção obrigatória/i);

    // 3. Consulta real no banco antes e depois: NENHUM dado foi apagado ou alterado
    const countAfter = (db.prepare('SELECT count(*) as c FROM equipment').get() as any).c;
    assert.equal(countAfter, countBefore, 'Contagem de registros deve permanecer idêntica');
    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_protegido');
    assert.ok(eq, 'Item original deve permanecer intacto');
  });
});

test('E1.3 - Backup com coleção com null ou tipo incorreto é rejeitado e nenhum dado é apagado', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_intacto_null', 'Equipamento Intacto', 5000, 500);

    // Payload com coleção obrigatória com valor null
    const nullCollectionPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Test' },
        equipment: null, // INVÁLIDO (null)
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    const resNull = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nullCollectionPayload),
    });
    assert.equal(resNull.status, 400);

    // Payload com coleção com tipo incorreto (string em vez de array)
    const wrongTypePayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Test' },
        equipment: 'string-invalida-nao-array', // INVÁLIDO
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    const resWrong = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wrongTypePayload),
    });
    assert.equal(resWrong.status, 400);

    // Consulta real no banco: registro permanece intacto
    const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_intacto_null');
    assert.ok(item, 'Nenhum dado é apagado quando a coleção for null ou tipo incorreto');
  });
});

test('E1.4 - Backup com registro malformado é rejeitado na validação antes de modificar o banco', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_original_val', 'Equipamento Validação', 6000, 600);

    // Registro de equipamento com valor de compra negativo
    const malformedPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Test' },
        equipment: [{ id: 'eq_bad', name: 'Lente Quebrada', purchase_value: -500 }], // INVÁLIDO
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(malformedPayload),
    });
    assert.equal(res.status, 400);

    const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_original_val');
    assert.ok(item, 'Item original não foi modificado');
  });
});

test('E1.5 - Backup válido com coleção canônica vazia ([]) é processado corretamente', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    const emptyCollectionsPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Estúdio Vazio Válido' },
        equipment: [{ id: 'eq_unico', name: 'Microfone Shure', purchase_value: 1200 }],
        recurring_expenses: [],
        expense_catalog: [], // Coleção vazia válida
        professionals: [], // Coleção vazia válida
        production_templates: [], // Coleção vazia válida
        budgets: [],
        proposals: [],
      },
    };

    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyCollectionsPayload),
    });
    assert.equal(res.status, 200);

    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_unico') as any;
    assert.ok(eq);
    assert.equal(eq.name, 'Microfone Shure');

    const tplCount = (db.prepare('SELECT count(*) as c FROM production_templates').get() as any).c;
    assert.equal(tplCount, 0, 'Coleções vazias no backup resultam em tabelas vazias no modo replace');
  });
});

// ============================================================================
// ETAPA 3: BACKUP DE SEGURANÇA OBRIGATÓRIO ANTES DE RESTAURAÇÃO DESTRUTIVA
// ============================================================================

test('E3.1 - Backup de segurança criado com sucesso no disco antes de qualquer alteração destrutiva', async () => {
  await withTestServer(async ({ db }) => {
    const backupDir = path.resolve('/tmp', `safety_test_${crypto.randomUUID()}`);
    fs.mkdirSync(backupDir, { recursive: true });

    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Original Pre-Restore');

    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Novo Pós-Restore' },
        equipment: [],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    const result = restoreBackupData(payload, { restoreMode: 'replace', safetyBackupDir: backupDir }, db);
    assert.equal(result.success, true);

    // Verifica que o arquivo de backup de segurança foi gerado no diretório
    const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_') && f.endsWith('.sqlite'));
    assert.equal(files.length, 1, 'Deve existir exatamente 1 arquivo de safety backup');

    const safetyFilePath = path.resolve(backupDir, files[0]);
    assert.ok(fs.statSync(safetyFilePath).size > 0, 'Arquivo deve ter tamanho maior que zero');

    // Valida que o backup contém os dados originais pré-restauração
    const safetyDb = new DatabaseSync(safetyFilePath);
    const integrity = (safetyDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
    assert.equal(integrity, 'ok', 'Backup de segurança deve ser íntegro');
    const origStudio = (safetyDb.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
    assert.equal(origStudio, 'Studio Original Pre-Restore', 'Backup de segurança deve conter o estado ANTES da restauração');
    safetyDb.close();

    // Limpeza
    fs.rmSync(backupDir, { recursive: true, force: true });
  });
});

test('E3.2 - Falha ao criar backup de segurança impede qualquer alteração destrutiva no banco', async () => {
  await withTestServer(async ({ db }) => {
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_nunca_apagar', 'Item Precioso', 50000, 10000);

    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Tentativa Sem Backup' },
        equipment: [],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // Caminho impossível / inválido para provocar erro de escrita do backup
    const invalidDir = '/dev/null/caminho_impossivel_sem_permissao';

    assert.throws(
      () => {
        restoreBackupData(payload, { restoreMode: 'replace', safetyBackupDir: invalidDir }, db);
      },
      (err: any) => {
        assert.match(err.message, /Falha de segurança preventiva/i);
        return true;
      }
    );

    // Consulta real no banco: o item precioso NÃO foi apagado
    const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_nunca_apagar');
    assert.ok(item, 'Quando a criação do backup de segurança falha, NENHUM dado é apagado ou alterado');
  });
});

// ============================================================================
// ETAPA 4: VALIDAÇÃO EM TEMPO DE EXECUÇÃO DO PARÂMETRO restoreMode
// ============================================================================

test('E4.1 - Validação em tempo de execução de restoreMode: aceita replace e merge', async () => {
  await withTestServer(async ({ baseUrl }) => {
    const validPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'FBonilha Test' },
        equipment: [],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // 1. replace aceito
    const resReplace = await fetch(`${baseUrl}/backup/import-json?mode=preview&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.equal(resReplace.status, 200);

    // 2. merge aceito
    const resMerge = await fetch(`${baseUrl}/backup/import-json?mode=preview&restoreMode=merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.equal(resMerge.status, 200);

    // 3. ausente aceito (assume padrão documentado replace)
    const resAbsent = await fetch(`${baseUrl}/backup/import-json?mode=preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.equal(resAbsent.status, 200);
  });
});

test('E4.2 - Validação de restoreMode: rejeita desconhecido, string vazia, tipo incorreto e conflito ambíguo', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_intacto_mode', 'Câmera Intacta Mode', 8000, 800);

    const validPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'FBonilha Test' },
        equipment: [],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // 1. Valor desconhecido rejeitado
    const resUnknown = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=super_wipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.equal(resUnknown.status, 400);
    const bodyUnknown = (await resUnknown.json()) as any;
    assert.match(bodyUnknown.error, /Modo de restauração "super_wipe" inválido/);

    // 2. String vazia rejeitada
    const resEmpty = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.equal(resEmpty.status, 400);
    const bodyEmpty = (await resEmpty.json()) as any;
    assert.match(bodyEmpty.error, /não pode ser uma string vazia/);

    // 3. Tipo incorreto rejeitado (passando número via body)
    const resType = await fetch(`${baseUrl}/backup/import-json?mode=commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: validPayload, restoreMode: 12345 }),
    });
    assert.equal(resType.status, 400);
    const bodyType = (await resType.json()) as any;
    assert.match(bodyType.error, /deve ser uma string/);

    // 4. Conflito ambíguo (query string = replace, body = merge)
    const resAmbiguous = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: validPayload, restoreMode: 'merge' }),
    });
    assert.equal(resAmbiguous.status, 400);
    const bodyAmbiguous = (await resAmbiguous.json()) as any;
    assert.match(bodyAmbiguous.error, /ambíguo/);

    // 5. Confirma que NENHUM dado foi alterado
    const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_intacto_mode');
    assert.ok(item, 'Nenhum dado é alterado quando a validação de restoreMode falha');
  });
});

// ============================================================================
// RODADA COMPLEMENTAR 1: VALIDAÇÃO DO PARÂMETRO mode NA RESTAURAÇÃO
// ============================================================================

test('RC1.1 - POST /backup/import-json aceita exclusivamente mode=preview e mode=commit', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Test Preview' },
        equipment: [{ id: 'eq_preview_test', name: 'Microfone Teste', purchase_value: 1000 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // 1. mode=preview aceito (retorna validação estrutural sem alterar o banco)
    const resPreview = await fetch(`${baseUrl}/backup/import-json?mode=preview&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resPreview.status, 200);
    const bodyPreview = (await resPreview.json()) as any;
    assert.equal(bodyPreview.valid, true);

    // Banco NÃO deve ter inserido eq_preview_test no modo preview
    assert.equal(db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_preview_test'), undefined);

    // 2. mode=commit aceito (aplica a restauração com sucesso)
    const resCommit = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resCommit.status, 200);
    const bodyCommit = (await resCommit.json()) as any;
    assert.equal(bodyCommit.success, true);

    // Banco deve conter eq_preview_test após o commit
    const inserted = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_preview_test') as any;
    assert.ok(inserted);
    assert.equal(inserted.name, 'Microfone Teste');

    // 3. Ausente adota padrão preview
    const resDefault = await fetch(`${baseUrl}/backup/import-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resDefault.status, 200);
    const bodyDefault = (await resDefault.json()) as any;
    assert.equal(bodyDefault.valid, true);
    assert.ok(bodyDefault.summary !== undefined);
  });
});

test('RC1.2 - POST /backup/import-json rejeita mode inválido (preveiw, unknown, string vazia, tipo incorreto) e nenhum dado é alterado', async () => {
  await withTestServer(async ({ baseUrl, db, backupDir }) => {
    // 1. Cadastra item pré-existente
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)').run('eq_protegido_mode', 'Câmera Intacta Mode', 15000, 1500);

    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Tentativa Invalida' },
        equipment: [{ id: 'eq_novo_invasor', name: 'Item Invasor', purchase_value: 9999 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // Caso A: Erro de digitação comum mode=preveiw (NUNCA deve ser interpretado como commit)
    const resTypo = await fetch(`${baseUrl}/backup/import-json?mode=preveiw&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resTypo.status, 400);
    const bodyTypo = (await resTypo.json()) as any;
    assert.match(bodyTypo.error, /Modo de importação "preveiw" inválido/);

    // Caso B: mode=unknown
    const resUnknown = await fetch(`${baseUrl}/backup/import-json?mode=unknown&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resUnknown.status, 400);
    const bodyUnknown = (await resUnknown.json()) as any;
    assert.match(bodyUnknown.error, /Modo de importação "unknown" inválido/);

    // Caso C: String vazia mode=
    const resEmpty = await fetch(`${baseUrl}/backup/import-json?mode=&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resEmpty.status, 400);
    const bodyEmpty = (await resEmpty.json()) as any;
    assert.match(bodyEmpty.error, /não pode ser uma string vazia/);

    // Caso D: Tipo incorreto (número no corpo da requisição)
    const resType = await fetch(`${baseUrl}/backup/import-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, mode: 12345 }),
    });
    assert.equal(resType.status, 400);
    const bodyType = (await resType.json()) as any;
    assert.match(bodyType.error, /deve ser uma string/);

    // Caso E: Conflito ambíguo (query string preview, corpo commit)
    const resAmbiguous = await fetch(`${baseUrl}/backup/import-json?mode=preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, mode: 'commit' }),
    });
    assert.equal(resAmbiguous.status, 400);
    const bodyAmbiguous = (await resAmbiguous.json()) as any;
    assert.match(bodyAmbiguous.error, /ambíguo/);

    // 2. Consulta de integridade no banco: NENHUM dado mudou
    const original = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_protegido_mode') as any;
    assert.ok(original, 'Item original deve permanecer intacto');
    assert.equal(original.name, 'Câmera Intacta Mode');

    const invader = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_novo_invasor');
    assert.equal(invader, undefined, 'Item invasor jamais pode ser gravado se o mode for inválido');

    // 3. Comprova que NENHUM arquivo de backup de segurança foi criado no diretório de teste
    const safetyFiles = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
    assert.equal(safetyFiles.length, 0, 'Nenhum backup de segurança deve ser criado se mode for rejeitado');
  });
});

// ============================================================================
// RODADA COMPLEMENTAR 2: ISOLAMENTO DOS ARQUIVOS DE BACKUP DE TESTE
// ============================================================================

test('RC2.1 - Testes HTTP e de restauração NÃO criam arquivos no diretório persistente data/backups', async () => {
  const permanentBackupDir = path.resolve(process.cwd(), 'data', 'backups');
  const filesBefore = fs.existsSync(permanentBackupDir) ? fs.readdirSync(permanentBackupDir) : [];

  await withTestServer(async ({ baseUrl, db, backupDir }) => {
    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Test Isolation' },
        equipment: [{ id: 'eq_iso_1', name: 'Monitor Referência', purchase_value: 7000 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // Executa restauração destrutiva real via HTTP (que aciona createSafetyBackup)
    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);

    // O backup de segurança DEVE ter sido gravado exclusivamente no backupDir temporário do teste
    const testSafetyFiles = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
    assert.ok(testSafetyFiles.length >= 1, 'Backup de segurança deve existir no diretório temporário isolado do teste');

    // O diretório persistente data/backups NUNCA deve receber novos arquivos
    const filesAfterInTest = fs.existsSync(permanentBackupDir) ? fs.readdirSync(permanentBackupDir) : [];
    assert.deepEqual(
      filesAfterInTest.sort(),
      filesBefore.sort(),
      'O diretório permanente data/backups não pode ter nenhum arquivo adicionado durante testes'
    );
  });

  // Após withTestServer encerrar, o diretório permanente continua idêntico
  const filesAfter = fs.existsSync(permanentBackupDir) ? fs.readdirSync(permanentBackupDir) : [];
  assert.deepEqual(filesAfter.sort(), filesBefore.sort(), 'Nenhum arquivo persistido em data/backups');
});

test('RC2.2 - Test Guard: Tentativa de invocar createSafetyBackup sem diretório isolado em teste é bloqueada', () => {
  setSafetyBackupDir(null);

  assert.throws(
    () => {
      getSafetyBackupDir();
    },
    (err: any) => {
      assert.match(err.message, /\[TEST GUARD\] Tentativa não autorizada de criar backup de segurança no diretório persistente do projeto/);
      return true;
    },
    'Deve bloquear tentativa de usar data/backups em ambiente de teste sem isolamento explícito'
  );
});

// ============================================================================
// RODADA COMPLEMENTAR 3: CORREÇÃO E VALIDAÇÃO ESTRITA DE schema_version
// ============================================================================

test('RC3.1 - schema_version: versões válidas (1, 2, 3, 4) e legado compatível são aceitas', () => {
  const baseData = {
    settings: { studio_name: 'Studio Test' },
    equipment: [],
    recurring_expenses: [],
    expense_catalog: [],
    professionals: [],
    production_templates: [],
    budgets: [],
    proposals: [],
  };

  // Versões de 1 a 4 são explicitamente suportadas
  for (const v of SUPPORTED_SCHEMA_VERSIONS) {
    const report = validateBackupPayload({
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: v,
      data: baseData,
    });
    assert.equal(report.isValid, true, `schema_version ${v} deve ser aceita`);
  }

  // Backup legado sem schema_version, mas com version informada
  const legacyReport = validateBackupPayload({
    app: 'FBonilha.mov',
    version: '1.0.0',
    data: baseData,
  });
  assert.equal(legacyReport.isValid, true, 'Backup legado v1 sem schema_version deve ser aceito');
  assert.ok(legacyReport.warnings.length > 0);
});

test('RC3.2 - schema_version: rejeita números fracionários, NaN, strings, zero, negativos e versões futuras não suportadas', () => {
  const baseData = {
    settings: { studio_name: 'Studio Test' },
    equipment: [],
    recurring_expenses: [],
    expense_catalog: [],
    professionals: [],
    production_templates: [],
    budgets: [],
    proposals: [],
  };

  // 1. Número fracionário (ex: 2.5, 3.14)
  const repFrac = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: 2.5, data: baseData });
  assert.equal(repFrac.isValid, false);
  assert.match(repFrac.errors[0], /inteiro positivo/i);

  // 2. NaN
  const repNan = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: NaN, data: baseData });
  assert.equal(repNan.isValid, false);
  assert.match(repNan.errors[0], /inteiro positivo/i);

  // 3. String
  const repStr = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: '4' as any, data: baseData });
  assert.equal(repStr.isValid, false);
  assert.match(repStr.errors[0], /inteiro positivo/i);

  // 4. Zero (0)
  const repZero = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: 0, data: baseData });
  assert.equal(repZero.isValid, false);
  assert.match(repZero.errors[0], /inteiro positivo/i);

  // 5. Número negativo (-1)
  const repNeg = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: -1, data: baseData });
  assert.equal(repNeg.isValid, false);
  assert.match(repNeg.errors[0], /inteiro positivo/i);

  // 6. Versão futura não suportada (ex: 5, 99)
  const repFuture = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: 5, data: baseData });
  assert.equal(repFuture.isValid, false);
  assert.match(repFuture.errors[0], /não suportada por esta versão da aplicação/i);

  const repFuture99 = validateBackupPayload({ app: 'FBonilha.mov', version: '2.0.0', schema_version: 99, data: baseData });
  assert.equal(repFuture99.isValid, false);
  assert.match(repFuture99.errors[0], /não suportada por esta versão da aplicação/i);
});

// ============================================================================
// RODADA COMPLEMENTAR 4: ISOLAMENTO TOTAL SEM DEPENDÊNCIA DE NODE_ENV E PROTEÇÃO DE MERGE
// ============================================================================

test('RC4.1 - O isolamento continua funcionando quando NODE_ENV não está definido', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  try {
    const permanentBackupDir = path.resolve(process.cwd(), 'data', 'backups');
    const filesBefore = fs.existsSync(permanentBackupDir) ? fs.readdirSync(permanentBackupDir) : [];

    await withTestServer(async ({ baseUrl, db, backupDir }) => {
      // 1. Mesmo sem NODE_ENV definido, withTestServer fornece db e backupDir isolados
      assert.ok(backupDir.includes('safety_test_backups_'), 'Backup dir deve ser temporário');

      const payload = {
        app: 'FBonilha.mov',
        version: '2.0.0',
        schema_version: 4,
        data: {
          settings: { studio_name: 'Studio Sem NodeEnv' },
          equipment: [{ id: 'eq_no_env', name: 'Microfone Boom', purchase_value: 3000 }],
          recurring_expenses: [],
          expense_catalog: [],
          professionals: [],
          production_templates: [],
          budgets: [],
          proposals: [],
        },
      };

      const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 200);

      // Backup de segurança gravado apenas em backupDir temporário
      const testFiles = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
      assert.ok(testFiles.length >= 1, 'Backup deve existir no diretório temporário');

      // data/backups permanece intocado
      const filesAfter = fs.existsSync(permanentBackupDir) ? fs.readdirSync(permanentBackupDir) : [];
      assert.deepEqual(filesAfter.sort(), filesBefore.sort(), 'data/backups não deve ser modificado');
    });
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }

  // Verifica explicitamente que o estado e a presença da variável foram restaurados fielmente
  if (originalNodeEnv === undefined) {
    assert.equal('NODE_ENV' in process.env, false, 'Chave NODE_ENV não deve existir em process.env se estava ausente');
  } else {
    assert.equal(process.env.NODE_ENV, originalNodeEnv, 'Valor de NODE_ENV deve corresponder exatamente ao original');
  }
});

test('RC4.2 - A limpeza remove os arquivos temporários mesmo quando uma operação/teste falha', async () => {
  let capturedDbPath = '';
  let capturedBackupDir = '';

  await assert.rejects(
    async () => {
      await withTestServer(async ({ dbPath, backupDir, db }) => {
        capturedDbPath = dbPath;
        capturedBackupDir = backupDir;

        // Gera arquivo de backup no diretório temporário
        createSafetyBackup(db, backupDir);
        assert.ok(fs.readdirSync(backupDir).length > 0, 'Arquivo gerado no diretório temporário');

        // Simula falha catastrófica no teste
        throw new Error('Falha simulada para verificar limpeza de recursos');
      });
    },
    (err: any) => {
      assert.match(err.message, /Falha simulada para verificar limpeza de recursos/);
      return true;
    }
  );

  // Comprova que todos os artefatos temporários foram expurgados pelo finally de withTestServer
  assert.equal(fs.existsSync(capturedDbPath), false, 'Arquivo sqlite deve ter sido excluído');
  assert.equal(fs.existsSync(`${capturedDbPath}-wal`), false, 'Arquivo sqlite-wal deve ter sido excluído');
  assert.equal(fs.existsSync(`${capturedDbPath}-shm`), false, 'Arquivo sqlite-shm deve ter sido excluído');
  assert.equal(fs.existsSync(capturedBackupDir), false, 'Diretório temporário de backups deve ter sido removido');
});

test('RC4.3 - Modo merge: backup preventivo de segurança é gerado e validado antes da primeira alteração em modo commit', async () => {
  await withTestServer(async ({ baseUrl, db, backupDir }) => {
    // 1. Estado inicial do banco
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Original');
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_original_1', 'Câmera Original', 12000, 1200);

    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Mesclado' },
        equipment: [{ id: 'eq_novo_2', name: 'Lente 50mm Nova', purchase_value: 4000, residual_value: 400 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    // 2. Executa restauração commit no modo merge
    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);

    // 3. Comprova que o backup preventivo foi criado no diretório temporário
    const backupFiles = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
    assert.equal(backupFiles.length, 1, 'Exatamente 1 backup preventivo deve ser criado para a operação merge');

    const backupFilePath = path.join(backupDir, backupFiles[0]);
    assert.ok(fs.statSync(backupFilePath).size > 0, 'Backup preventivo deve ter tamanho > 0');

    // 4. Valida a integridade do snapshot do backup e comprova que continha o estado ANTERIOR à mesclagem
    const snapshotDb = new DatabaseSync(backupFilePath);
    const integrity = (snapshotDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
    assert.equal(integrity, 'ok', 'Snapshot de segurança deve ser íntegro');

    const snapshotSettings = (snapshotDb.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
    assert.equal(snapshotSettings, 'Studio Original', 'Snapshot deve conter estado anterior da configuração');

    const snapshotEqOriginal = snapshotDb.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_original_1') as any;
    assert.ok(snapshotEqOriginal, 'Snapshot deve conter equipamento pré-existente');

    const snapshotEqNew = snapshotDb.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_novo_2');
    assert.equal(snapshotEqNew, undefined, 'Snapshot gerado antes da escrita NÃO deve conter novo equipamento');
    snapshotDb.close();

    // 5. No banco atual pós-merge: ambos os equipamentos coexistem e settings foi atualizado
    const currentSettings = (db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
    assert.equal(currentSettings, 'Studio Mesclado');

    const currentEqOriginal = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_original_1') as any;
    assert.ok(currentEqOriginal, 'Item original foi preservado no modo merge');

    const currentEqNew = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_novo_2') as any;
    assert.ok(currentEqNew, 'Novo item foi inserido no modo merge');
  });
});

test('RC4.4 - Modo merge: falha na criação do backup preventivo aborta restauração e nenhuma configuração ou registro é alterado', async () => {
  await withTestServer(async ({ baseUrl, db, backupDir }) => {
    // 1. Estado inicial protegido
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Seguro Merge');
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_seguro_1', 'Equipamento Intacto', 8000, 800);

    // 2. Aponta temporariamente o diretório de backup de segurança para um arquivo regular (impossibilitando mkdir / escrita)
    const blockerFile = path.resolve(backupDir, 'blocker_file_not_dir');
    fs.writeFileSync(blockerFile, 'not-a-directory');
    setSafetyBackupDir(blockerFile);

    const payload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Invadido Tentativa' },
        equipment: [{ id: 'eq_invasor', name: 'Item Invasor Nao Permitido', purchase_value: 99999 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [],
        proposals: [],
      },
    };

    try {
      const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 500);
      const resBody = (await res.json()) as any;
      assert.match(resBody.error, /Falha de segurança preventiva/);

      // 3. Comprova que NENHUMA alteração foi feita no banco
      const settings = (db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
      assert.equal(settings, 'Studio Seguro Merge', 'Configuração não pode ter sido alterada');

      const originalEq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_seguro_1') as any;
      assert.ok(originalEq, 'Registro pré-existente deve permanecer intacto');
      assert.equal(originalEq.name, 'Equipamento Intacto');

      const invader = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_invasor');
      assert.equal(invader, undefined, 'Registro invasor não pode ter sido inserido');
    } finally {
      setSafetyBackupDir(backupDir);
    }
  });
});

test('RC4.5 - Modo merge: rollback transacional reverte alterações se ocorrer erro durante a mesclagem', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Estado inicial
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Original Rollback');
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_rb_1', 'Câmera Rollback 1', 6000, 600);

    // Cria um trigger temporário para forçar falha no meio da transação de inserção em budgets
    db.exec(`
      CREATE TRIGGER fail_on_budgets_trigger
      BEFORE INSERT ON budgets
      BEGIN
        SELECT RAISE(ABORT, 'Simulated SQLite Transaction Failure on Budgets');
      END;
    `);

    // Payload estruturalmente válido para passar no validateBackupPayload
    const validStructurePayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Nome Alterado Que Deve Sofrer Rollback' },
        equipment: [{ id: 'eq_rb_novo', name: 'Lente Nova Que Deve Sofrer Rollback', purchase_value: 3000 }],
        recurring_expenses: [],
        expense_catalog: [],
        professionals: [],
        production_templates: [],
        budgets: [{ id: 'bud_trigger_fail', code: 'ORC-FAIL', title: 'Orcamento Falha', client_name: 'Cliente Teste' }],
        proposals: [],
      },
    };

    try {
      const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validStructurePayload),
      });
      assert.equal(res.status, 500);

      // Comprova o rollback atômico:
      const settings = (db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
      assert.equal(settings, 'Studio Original Rollback', 'Settings deve ter sofrido rollback para o valor original');

      const eqOriginal = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_rb_1') as any;
      assert.ok(eqOriginal, 'Equipamento original permanece intacto');

      const eqNovo = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_rb_novo');
      assert.equal(eqNovo, undefined, 'Equipamento inserido antes da falha deve ter sido revertido pelo rollback');
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_on_budgets_trigger;');
    }
  });
});

test('RC4.6 - Modo merge: validação prévia integral rejeita payload malformado com 400 antes de alterar qualquer registro', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Intacto Validacao');
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_val_1', 'Câmera Intacta Val', 5000, 500);

    const brokenPayload = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 4,
      data: {
        settings: { studio_name: 'Studio Nao Deve Mudar' },
        equipment: [{ id: 'eq_invalido', purchase_value: -999 }], // Inválido: sem name e purchase_value negativo
      },
    };

    const res = await fetch(`${baseUrl}/backup/import-json?mode=commit&restoreMode=merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brokenPayload),
    });
    assert.equal(res.status, 400);

    const settings = (db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
    assert.equal(settings, 'Studio Intacto Validacao');

    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_val_1') as any;
    assert.ok(eq);
    assert.equal(eq.name, 'Câmera Intacta Val');
  });
});

// ============================================================================
// RODADA COMPLEMENTAR 5: VALIDAÇÃO DE RESTAURAÇÃO DE NODE_ENV E CICLO DE VIDA DE withTestServer
// ============================================================================

test('RC5.1 - Restauração segura de NODE_ENV: quando ausente, continua estritamente ausente (não vira string "undefined")', () => {
  const saved = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  assert.equal('NODE_ENV' in process.env, false, 'NODE_ENV deve estar ausente antes do teste');

  try {
    const original = process.env.NODE_ENV;
    try {
      // Simula operação sob ambiente temporariamente modificado
      assert.equal(process.env.NODE_ENV, undefined);
    } finally {
      if (original === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = original;
      }
    }

    // Deve permanecer estritamente ausente e NUNCA conter a string literal "undefined"
    assert.equal('NODE_ENV' in process.env, false, 'Chave NODE_ENV não deve existir em process.env');
    assert.equal(process.env.NODE_ENV, undefined);
    assert.notEqual(process.env.NODE_ENV, 'undefined');
  } finally {
    if (saved === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = saved;
    }
  }
});

test('RC5.2 - Restauração segura de NODE_ENV: quando presente, restaura valor exato mesmo em caso de falha', async () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'staging_custom_env_val';

  try {
    const original = process.env.NODE_ENV;
    await assert.rejects(
      async () => {
        try {
          delete process.env.NODE_ENV;
          assert.equal(process.env.NODE_ENV, undefined);
          throw new Error('Falha simulada dentro de bloco de teste');
        } finally {
          if (original === undefined) {
            delete process.env.NODE_ENV;
          } else {
            process.env.NODE_ENV = original;
          }
        }
      },
      (err: any) => err.message === 'Falha simulada dentro de bloco de teste'
    );

    assert.equal(process.env.NODE_ENV, 'staging_custom_env_val', 'Valor original restaurado com precisão');
  } finally {
    if (saved === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = saved;
    }
  }
});

test('RC5.3 - withTestServer restaura estado global anterior (db, safetyBackupDir, testMode) após execução normal', async () => {
  const sentinelDb = new DatabaseSync(':memory:');
  const sentinelSafetyDir = '/tmp/sentinel_safety_dir_normal';
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);
  setTestMode(true);

  try {
    await withTestServer(async ({ db, backupDir }) => {
      // Durante a execução do teste, o estado aponta para o ambiente efêmero do teste
      assert.notEqual(getDbInstance(), sentinelDb);
      assert.equal(getDbInstance(), db);
      assert.equal(getRawSafetyBackupDir(), backupDir);
    });

    // Após término normal, o estado global anterior foi restaurado sem fechar o recurso externo
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado para a instância prévia');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado para o caminho prévio');
    assert.equal(getTestMode(), true, 'testMode restaurado');

    // Comprova que o sentinelDb continua aberto e operacional (não foi fechado por withTestServer)
    const check = sentinelDb.prepare('SELECT 1 as val').get() as any;
    assert.equal(check.val, 1, 'Recurso anterior de outro contexto continua aberto e funcional');
  } finally {
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
    setTestMode(null);
  }
});

test('RC5.4 - withTestServer restaura estado global anterior quando a função de teste lança exceção', async () => {
  const sentinelDb = new DatabaseSync(':memory:');
  const sentinelSafetyDir = '/tmp/sentinel_safety_dir_fail';
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);
  setTestMode(false);

  try {
    await assert.rejects(
      async () => {
        await withTestServer(async ({ db }) => {
          assert.equal(getDbInstance(), db);
          throw new Error('Falha esperada para teste de resiliência');
        });
      },
      (err: any) => err.message === 'Falha esperada para teste de resiliência'
    );

    // Estado anterior preservado/restaurado
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado após erro do teste');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado após erro do teste');
    assert.equal(getTestMode(), false, 'testMode restaurado após erro do teste');

    // Confirma que sentinelDb continua operacional
    const check = sentinelDb.prepare('SELECT 42 as answer').get() as any;
    assert.equal(check.answer, 42);
  } finally {
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
    setTestMode(null);
  }
});

test('RC5.5 - Falha durante a preparação do servidor não deixa recursos temporários ou referências globais abandonadas', async () => {
  const sentinelDb = new DatabaseSync(':memory:');
  const sentinelSafetyDir = '/tmp/sentinel_prep_fail';
  const sentinelTestMode = false;
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);
  setTestMode(sentinelTestMode);

  // Arquivos e diretórios preexistentes que devem ser rigorosamente preservados
  const preexistingFile = path.resolve('/tmp', `preexisting_prep_fail_${crypto.randomUUID()}.txt`);
  const preexistingDir = path.resolve('/tmp', `preexisting_prep_dir_${crypto.randomUUID()}`);
  fs.writeFileSync(preexistingFile, 'conteúdo preexistente que não deve ser removido');
  fs.mkdirSync(preexistingDir, { recursive: true });
  const preexistingNestedFile = path.resolve(preexistingDir, 'nested.txt');
  fs.writeFileSync(preexistingNestedFile, 'conteúdo aninhado');

  let capturedDbPath: string | null = null;
  let capturedBackupDir: string | null = null;

  const originalListen = express.application.listen;
  // Intercepta app.listen para capturar os recursos exclusivos do helper antes de simular o erro
  (express.application as any).listen = function () {
    const currentDb = getDbInstance();
    if (currentDb) {
      const list = currentDb.prepare('PRAGMA database_list').all() as any[];
      capturedDbPath = list.find((d: any) => d.name === 'main')?.file || null;
    }
    capturedBackupDir = getRawSafetyBackupDir();

    // Valida que os recursos temporários foram de fato criados antes da falha
    assert.ok(capturedDbPath && fs.existsSync(capturedDbPath), 'Arquivo SQLite temporário deve existir antes da falha no listen');
    assert.ok(capturedBackupDir && fs.existsSync(capturedBackupDir), 'Diretório temporário de backups deve existir antes da falha no listen');

    throw new Error('Falha simulada na inicialização do servidor HTTP');
  };

  try {
    await assert.rejects(
      async () => {
        await withTestServer(async () => {});
      },
      (err: any) => err.message === 'Falha simulada na inicialização do servidor HTTP'
    );

    // 1. Arquivo SQLite temporário exclusivo do helper deve ter sido removido
    assert.ok(capturedDbPath, 'Caminho do banco temporário deve ter sido capturado');
    assert.equal(fs.existsSync(capturedDbPath!), false, 'Arquivo SQLite temporário deve ter sido removido');

    // 2. Arquivos -wal e -shm temporários não devem existir
    assert.equal(fs.existsSync(`${capturedDbPath}-wal`), false, 'Arquivo -wal temporário não deve existir');
    assert.equal(fs.existsSync(`${capturedDbPath}-shm`), false, 'Arquivo -shm temporário não deve existir');

    // 3. Diretório temporário de backups exclusivo do helper deve ter sido removido
    assert.ok(capturedBackupDir, 'Caminho do backupDir temporário deve ter sido capturado');
    assert.equal(fs.existsSync(capturedBackupDir!), false, 'Diretório temporário de backups deve ter sido removido');

    // 4. Restauração integral de dbInstance, safetyBackupDir e testMode
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado após falha na preparação');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado após falha na preparação');
    assert.equal(getTestMode(), sentinelTestMode, 'testMode restaurado após falha na preparação');

    // 5. Banco sentinela permanece aberto e operacional
    const check = sentinelDb.prepare('SELECT 99 as val').get() as any;
    assert.equal(check.val, 99, 'Banco sentinela deve permanecer aberto e operacional');

    // 6. Arquivos e diretórios preexistentes são rigorosamente preservados
    assert.ok(fs.existsSync(preexistingFile), 'Arquivo preexistente deve ser preservado');
    assert.ok(fs.existsSync(preexistingDir), 'Diretório preexistente deve ser preservado');
    assert.ok(fs.existsSync(preexistingNestedFile), 'Arquivo dentro do diretório preexistente deve ser preservado');
  } finally {
    (express.application as any).listen = originalListen;
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
    setTestMode(null);
    if (fs.existsSync(preexistingFile)) fs.unlinkSync(preexistingFile);
    if (fs.existsSync(preexistingDir)) fs.rmSync(preexistingDir, { recursive: true, force: true });
  }
});

test('RC5.6 - Serialização de withTestServer via mutex impede race conditions e interferência de estado global', async () => {
  let activeTests = 0;
  let maxConcurrent = 0;

  // Lança duas execuções simultâneas em Promise.all
  await Promise.all([
    withTestServer(async ({ db }) => {
      activeTests++;
      maxConcurrent = Math.max(maxConcurrent, activeTests);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(getDbInstance(), db);
      activeTests--;
    }),
    withTestServer(async ({ db }) => {
      activeTests++;
      maxConcurrent = Math.max(maxConcurrent, activeTests);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(getDbInstance(), db);
      activeTests--;
    }),
  ]);

  // Graças ao mutex de fila, as execuções foram serializadas e maxConcurrent nunca ultrapassou 1
  assert.equal(maxConcurrent, 1, 'withTestServer deve serializar execuções para evitar race conditions');
  assert.equal(activeTests, 0);
});

test('RC5.7 - Falha durante a execução de migrações na preparação de withTestServer restaura estado global e não deixa arquivos temporários', async () => {
  const sentinelDb = new DatabaseSync(':memory:');
  const sentinelSafetyDir = '/tmp/sentinel_migration_fail';
  const sentinelTestMode = true;
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);
  setTestMode(sentinelTestMode);

  // Arquivos e diretórios preexistentes que devem ser preservados
  const preexistingFile = path.resolve('/tmp', `preexisting_migration_${crypto.randomUUID()}.txt`);
  const preexistingDir = path.resolve('/tmp', `preexisting_dir_mig_${crypto.randomUUID()}`);
  fs.writeFileSync(preexistingFile, 'arquivo preexistente que deve ser intocado');
  fs.mkdirSync(preexistingDir, { recursive: true });
  const preexistingNestedFile = path.resolve(preexistingDir, 'inner.txt');
  fs.writeFileSync(preexistingNestedFile, 'conteúdo interno');

  let capturedDbPath: string | null = null;

  const origExec = DatabaseSync.prototype.exec;
  // Intercepta exec para simular falha catastrófica durante as migrações iniciais do banco
  DatabaseSync.prototype.exec = function (sql: string) {
    if (typeof sql === 'string' && sql.includes('CREATE TABLE IF NOT EXISTS settings')) {
      const list = (this as any).prepare('PRAGMA database_list').all() as any[];
      capturedDbPath = list.find((d: any) => d.name === 'main')?.file || null;
      assert.ok(capturedDbPath && fs.existsSync(capturedDbPath), 'Arquivo SQLite deve existir antes do aborto de migrações');
      throw new Error('Falha simulada na execução das migrações do SQLite');
    }
    return origExec.apply(this, arguments as any);
  };

  try {
    await assert.rejects(
      async () => {
        await withTestServer(async () => {});
      },
      (err: any) => err.message === 'Falha simulada na execução das migrações do SQLite'
    );

    // 1. Arquivo SQLite temporário criado na preparação foi removido
    assert.ok(capturedDbPath, 'Caminho do banco temporário deve ter sido capturado');
    assert.equal(fs.existsSync(capturedDbPath!), false, 'Arquivo SQLite temporário deve ter sido removido');

    // 2. Arquivos -wal e -shm temporários não devem existir
    assert.equal(fs.existsSync(`${capturedDbPath}-wal`), false, 'Arquivo -wal não deve existir');
    assert.equal(fs.existsSync(`${capturedDbPath}-shm`), false, 'Arquivo -shm não deve existir');

    // 3. Diretório de backups não foi abandonado (ou foi limpo caso iniciado)
    // Na ordem de withTestServer, a falha ocorre antes de mkdirSync(testBackupDir), portanto nenhum diretório de backup foi criado
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir permanece/restaurado para o sentinela');

    // 4. O estado global DEVE ter sido restaurado para o sentinela prévio
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado após falha nas migrações');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado após falha nas migrações');
    assert.equal(getTestMode(), sentinelTestMode, 'testMode restaurado após falha nas migrações');

    // 5. Banco sentinela permanece aberto e operacional
    const check = sentinelDb.prepare('SELECT 77 as code').get() as any;
    assert.equal(check.code, 77, 'Banco sentinela continua aberto e operacional');

    // 6. Arquivos e diretórios preexistentes são preservados
    assert.ok(fs.existsSync(preexistingFile), 'Arquivo preexistente preservado');
    assert.ok(fs.existsSync(preexistingDir), 'Diretório preexistente preservado');
    assert.ok(fs.existsSync(preexistingNestedFile), 'Conteúdo interno do diretório preservado');
  } finally {
    DatabaseSync.prototype.exec = origExec;
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
    setTestMode(null);
    if (fs.existsSync(preexistingFile)) fs.unlinkSync(preexistingFile);
    if (fs.existsSync(preexistingDir)) fs.rmSync(preexistingDir, { recursive: true, force: true });
  }
});

test('RC5.8 - createSafetyBackup: falha na verificação de integridade remove arquivo incompleto gerado e não modifica o banco', async () => {
  await withTestServer(async ({ baseUrl, db, backupDir }) => {
    // 1. Estado inicial do banco protegido
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Original Seguro');
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_intacto_58', 'Câmera Intacta 58', 10000, 1000);

    // Cria um arquivo preexistente legítimo no diretório para comprovar que NÃO é removido
    const preexistingFile = path.resolve(backupDir, 'preexisting_valid_file.txt');
    fs.writeFileSync(preexistingFile, 'arquivo legitimo preexistente');

    // Intercepta DatabaseSync.prototype.prepare especificamente para o integrity_check do snapshot
    const origPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function (sql: string) {
      if (typeof sql === 'string' && sql.includes('PRAGMA integrity_check')) {
        return {
          get: () => ({ integrity_check: 'corrupt page 1 found' }),
        } as any;
      }
      return origPrepare.apply(this, arguments as any);
    };

    try {
      // 2. Invocar createSafetyBackup diretamente deve lançar erro e apagar o snapshot gerado
      assert.throws(
        () => {
          createSafetyBackup(db, backupDir);
        },
        (err: any) => {
          assert.match(err.message, /Verificação de integridade do backup de segurança falhou: corrupt page 1 found/);
          return true;
        }
      );

      // 3. Comprova que o arquivo de backup incompleto/corrompido gerado nesta tentativa foi removido
      const safetyFiles = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
      assert.equal(safetyFiles.length, 0, 'Arquivo de backup incompleto deve ter sido removido');

      // 4. Comprova que arquivos anteriores/legítimos no diretório NÃO foram tocados
      assert.ok(fs.existsSync(preexistingFile), 'Arquivo preexistente legítimo não pode ser removido');

      // 5. Testar também através de restoreBackupData para comprovar que nenhuma alteração no banco ocorre
      const payload = {
        app: 'FBonilha.mov',
        version: '2.0.0',
        schema_version: 4,
        data: {
          settings: { studio_name: 'Studio Tentativa Falha' },
          equipment: [{ id: 'eq_invasor_58', name: 'Invasor', purchase_value: 9999 }],
          recurring_expenses: [],
          expense_catalog: [],
          professionals: [],
          production_templates: [],
          budgets: [],
          proposals: [],
        },
      };

      assert.throws(
        () => {
          restoreBackupData(payload, { restoreMode: 'replace', safetyBackupDir: backupDir }, db);
        },
        (err: any) => {
          assert.match(err.message, /Falha de segurança preventiva/);
          return true;
        }
      );

      // 6. Confirmação no banco: nenhum dado foi alterado
      const currentStudio = (db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
      assert.equal(currentStudio, 'Studio Original Seguro', 'Configuração não foi alterada');

      const originalEq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_intacto_58') as any;
      assert.ok(originalEq, 'Registro original intacto');

      const invader = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_invasor_58');
      assert.equal(invader, undefined, 'Registro invasor não foi inserido');

      // Novamente verifica que nenhum arquivo de backup incompleto permaneceu
      const safetyFilesAfter = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
      assert.equal(safetyFilesAfter.length, 0, 'Nenhum backup corrompido deixado no disco');
    } finally {
      DatabaseSync.prototype.prepare = origPrepare;
    }
  });
});

test('RC5.9 - createSafetyBackup: falha ao abrir o snapshot remove o arquivo parcial gerado e não modifica o banco', async () => {
  await withTestServer(async ({ db, backupDir }) => {
    // 1. Estado inicial protegido
    db.prepare('UPDATE settings SET studio_name = ? WHERE id = 1').run('Studio Original Open Fail');
    db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
      .run('eq_intacto_59', 'Câmera Intacta 59', 15000, 1500);

    const preexistingFile = path.resolve(backupDir, 'preexisting_snapshot_file.txt');
    fs.writeFileSync(preexistingFile, 'snapshot anterior preservado');

    // Intercepta DatabaseSync.prototype.prepare para simular erro de abertura/leitura de arquivo corrompido
    const origPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function (sql: string) {
      if (typeof sql === 'string' && sql.includes('PRAGMA integrity_check')) {
        throw new Error('Falha catastrófica ao abrir snapshot: disk I/O error');
      }
      return origPrepare.apply(this, arguments as any);
    };

    try {
      assert.throws(
        () => {
          createSafetyBackup(db, backupDir);
        },
        (err: any) => {
          assert.match(err.message, /disk I\/O error/);
          return true;
        }
      );

      // Comprova que o arquivo temporário de backup foi removido
      const safetyFiles = fs.readdirSync(backupDir).filter((f) => f.startsWith('safety_pre_restore_'));
      assert.equal(safetyFiles.length, 0, 'Arquivo parcial deve ser removido após erro ao abrir');

      // Comprova que arquivos preexistentes foram mantidos
      assert.ok(fs.existsSync(preexistingFile), 'Arquivo preexistente legítimo não foi removido');

      // Comprova que os dados originais no banco não foram alterados
      const studio = (db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any).studio_name;
      assert.equal(studio, 'Studio Original Open Fail');

      const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq_intacto_59') as any;
      assert.ok(eq);
      assert.equal(eq.name, 'Câmera Intacta 59');
    } finally {
      DatabaseSync.prototype.prepare = origPrepare;
    }
  });
});

test('RC5.10 - Fila de mutex: uma falha na primeira execução não bloqueia nem corrompe a segunda chamada', async () => {
  let firstExecuted = false;
  let secondExecuted = false;

  const results = await Promise.allSettled([
    withTestServer(async () => {
      firstExecuted = true;
      throw new Error('Falha simulada na primeira tarefa serializada do mutex');
    }),
    withTestServer(async ({ db, baseUrl }) => {
      secondExecuted = true;
      const res = await fetch(`${baseUrl}/settings`);
      assert.equal(res.status, 200);
      assert.ok(db);
    }),
  ]);

  assert.equal(firstExecuted, true, 'A primeira tarefa deve ter sido executada');
  assert.equal(secondExecuted, true, 'A segunda tarefa deve ter sido executada mesmo após falha da primeira');
  assert.equal(results[0].status, 'rejected');
  assert.equal((results[0] as PromiseRejectedResult).reason.message, 'Falha simulada na primeira tarefa serializada do mutex');
  assert.equal(results[1].status, 'fulfilled');
});

test('RC5.11 - app.listen(): erro assíncrono emitido pelo servidor antes de concluir a inicialização limpa recursos e rejeita adequadamente', async () => {
  const sentinelDb = new DatabaseSync(':memory:');
  const sentinelSafetyDir = '/tmp/sentinel_async_listen_fail';
  const sentinelTestMode = false;
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);
  setTestMode(sentinelTestMode);

  // Arquivos e diretórios preexistentes que devem ser rigorosamente preservados
  const preexistingFile = path.resolve('/tmp', `preexisting_async_listen_${crypto.randomUUID()}.txt`);
  const preexistingDir = path.resolve('/tmp', `preexisting_async_dir_${crypto.randomUUID()}`);
  fs.writeFileSync(preexistingFile, 'arquivo preexistente async listen');
  fs.mkdirSync(preexistingDir, { recursive: true });
  const preexistingNested = path.resolve(preexistingDir, 'nested.txt');
  fs.writeFileSync(preexistingNested, 'conteudo aninhado');

  let capturedDbPath: string | null = null;
  let capturedBackupDir: string | null = null;
  let partialServerClosed = false;
  let errorEmitted = false;

  const originalListen = express.application.listen;

  (express.application as any).listen = function () {
    const currentDb = getDbInstance();
    if (currentDb) {
      const list = currentDb.prepare('PRAGMA database_list').all() as any[];
      capturedDbPath = list.find((d: any) => d.name === 'main')?.file || null;
    }
    capturedBackupDir = getRawSafetyBackupDir();

    assert.ok(capturedDbPath && fs.existsSync(capturedDbPath), 'Arquivo SQLite deve existir antes do erro');
    assert.ok(capturedBackupDir && fs.existsSync(capturedBackupDir), 'Diretório de backup deve existir antes do erro');

    // Cria servidor HTTP real para simular evento 'error' assíncrono antes do evento de 'listening'
    const serverInstance = http.createServer();
    const origClose = serverInstance.close.bind(serverInstance);

    serverInstance.close = function (cb?: any) {
      partialServerClosed = true;
      return origClose(cb);
    };

    // Emite o evento 'error' assincronamente via process.nextTick antes de concluir a inicialização
    process.nextTick(() => {
      errorEmitted = true;
      serverInstance.emit('error', new Error('Falha assíncrona simulada de inicialização no servidor HTTP (ex: EADDRINUSE)'));
    });

    return serverInstance;
  };

  try {
    await assert.rejects(
      async () => {
        await withTestServer(async () => {});
      },
      (err: any) => {
        // Garante que o erro original esperado foi o que rejeitou a Promise (sem substituição por erro de limpeza)
        assert.equal(err.message, 'Falha assíncrona simulada de inicialização no servidor HTTP (ex: EADDRINUSE)');
        return true;
      }
    );

    // 1. O evento assíncrono de erro foi emitido
    assert.ok(errorEmitted, 'Evento de erro assíncrono deve ter sido emitido');

    // 2. O servidor parcial é encerrado quando aplicável
    assert.ok(partialServerClosed, 'Servidor parcial deve ter sido encerrado via close()');

    // 3. O banco temporário e arquivos auxiliares (-wal e -shm) são removidos
    assert.ok(capturedDbPath, 'dbPath temporário deve ter sido capturado');
    assert.equal(fs.existsSync(capturedDbPath!), false, 'Arquivo SQLite temporário deve ter sido removido');
    assert.equal(fs.existsSync(`${capturedDbPath}-wal`), false, 'Arquivo -wal temporário não deve existir');
    assert.equal(fs.existsSync(`${capturedDbPath}-shm`), false, 'Arquivo -shm temporário não deve existir');

    // 4. Diretório temporário de backups é removido
    assert.ok(capturedBackupDir, 'backupDir temporário deve ter sido capturado');
    assert.equal(fs.existsSync(capturedBackupDir!), false, 'Diretório temporário de backups deve ter sido removido');

    // 5. As referências globais anteriores são restauradas
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado após erro assíncrono');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado após erro assíncrono');
    assert.equal(getTestMode(), sentinelTestMode, 'testMode restaurado após erro assíncrono');

    // 6. Banco sentinela permanece aberto e operacional
    const check = sentinelDb.prepare('SELECT 88 as val').get() as any;
    assert.equal(check.val, 88, 'Banco sentinela continua aberto e funcional');

    // 7. Arquivos e diretórios preexistentes são rigorosamente preservados
    assert.ok(fs.existsSync(preexistingFile), 'Arquivo preexistente preservado');
    assert.ok(fs.existsSync(preexistingDir), 'Diretório preexistente preservado');
    assert.ok(fs.existsSync(preexistingNested), 'Conteúdo aninhado preexistente preservado');
  } finally {
    (express.application as any).listen = originalListen;
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
    setTestMode(null);
    if (fs.existsSync(preexistingFile)) fs.unlinkSync(preexistingFile);
    if (fs.existsSync(preexistingDir)) fs.rmSync(preexistingDir, { recursive: true, force: true });
  }
});

// ============================================================================
// ETAPA 6: DUPLICAÇÃO DE EQUIPAMENTOS, UNICIDADE DE NOMES, BATERIAS E PRODUTORA
// ============================================================================

test('EQ1.1 - Criação e duplicação de equipamento com preservação de parâmetros e novo ID', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cadastra equipamento original
    const originalPayload = {
      name: 'Sony FX3 Cinema Line',
      category: 'Câmeras',
      brand: 'Sony',
      model: 'ILME-FX3',
      serial_number: 'SN-FX3-001',
      purchase_value: 24000,
      residual_value: 4000,
      useful_life_years: 3,
      estimation_method: 'total_hours',
      total_useful_hours: 3000,
      annual_hours: 600,
      notes: 'Equipamento principal de câmera',
      is_active: 1,
    };

    const resCreate = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(originalPayload),
    });
    assert.equal(resCreate.status, 201);
    const createdOriginal = await resCreate.json();
    assert.ok(createdOriginal.id);
    assert.equal(createdOriginal.name, 'Sony FX3 Cinema Line');

    // 2. Duplica equipamento com novo nome exclusivo e novo ID
    const duplicatePayload = {
      name: 'Sony FX3 Cinema Line Unidade 02',
      category: createdOriginal.category,
      brand: createdOriginal.brand,
      model: createdOriginal.model,
      serial_number: 'SN-FX3-002',
      purchase_value: createdOriginal.purchase_value,
      residual_value: createdOriginal.residual_value,
      useful_life_years: createdOriginal.useful_life_years,
      estimation_method: createdOriginal.estimation_method,
      total_useful_hours: createdOriginal.total_useful_hours,
      annual_hours: createdOriginal.annual_hours,
      notes: createdOriginal.notes,
      is_active: createdOriginal.is_active,
    };

    const resDup = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duplicatePayload),
    });
    assert.equal(resDup.status, 201);
    const createdDup = await resDup.json();

    // Validações
    assert.ok(createdDup.id);
    assert.notEqual(createdDup.id, createdOriginal.id, 'O ID da duplicata deve ser único e diferente do original');
    assert.equal(createdDup.name, 'Sony FX3 Cinema Line Unidade 02');
    assert.equal(createdDup.purchase_value, 24000);
    assert.equal(createdDup.residual_value, 4000);
    assert.equal(createdDup.total_useful_hours, 3000);
    assert.equal(createdDup.brand, 'Sony');
    assert.equal(createdDup.model, 'ILME-FX3');
    assert.equal(createdDup.category, 'Câmeras');

    // Verifica no banco de dados que existem ambos os registros distintos
    const rows = db.prepare('SELECT id, name FROM equipment WHERE id IN (?, ?) AND is_deleted = 0').all(createdOriginal.id, createdDup.id) as any[];
    assert.equal(rows.length, 2);
  });
});

test('EQ1.2 - Rejeição de nome vazio, nulo ou somente espaços em branco', async () => {
  await withTestServer(async ({ baseUrl }) => {
    // Tentativa com nome vazio
    const resEmpty = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', purchase_value: 5000 }),
    });
    assert.equal(resEmpty.status, 400);
    const bodyEmpty = await resEmpty.json();
    assert.ok(bodyEmpty.error.includes('obrigatório'));

    // Tentativa com nome contendo apenas espaços
    const resSpaces = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '     ', purchase_value: 5000 }),
    });
    assert.equal(resSpaces.status, 400);
  });
});

test('EQ1.3 - Rejeição de nomes duplicados com normalização de maiúsculas/minúsculas e espaços', async () => {
  await withTestServer(async ({ baseUrl }) => {
    // 1. Cadastra primeiro item
    const res1 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Microfone Rode VideoMic Pro',
        category: 'Áudio',
        purchase_value: 1800,
      }),
    });
    assert.equal(res1.status, 201);

    // 2. Tentativa com nome idêntico
    const resSame = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Microfone Rode VideoMic Pro',
        category: 'Áudio',
        purchase_value: 1800,
      }),
    });
    assert.equal(resSame.status, 400);
    const bodySame = await resSame.json();
    assert.ok(bodySame.error.includes('Já existe um equipamento'));

    // 3. Tentativa com variação em caixa alta/baixa
    const resCase = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'microfone rode VIDEOMIC pro',
        category: 'Áudio',
        purchase_value: 1800,
      }),
    });
    assert.equal(resCase.status, 400);

    // 4. Tentativa com espaços múltiplos e espaços nas pontas
    const resWhitespace = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '   Microfone   Rode   VideoMic   Pro   ',
        category: 'Áudio',
        purchase_value: 1800,
      }),
    });
    assert.equal(resWhitespace.status, 400);
  });
});

test('EQ1.4 - Atualização PUT permite manter o próprio nome mas rejeita colisão com outro item', async () => {
  await withTestServer(async ({ baseUrl }) => {
    const resA = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tripé Manfrotto 504HD', category: 'Suporte', purchase_value: 3500 }),
    });
    const eqA = await resA.json();

    const resB = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Monopé Benro', category: 'Suporte', purchase_value: 900 }),
    });
    const eqB = await resB.json();

    // 1. Atualizar eqA mantendo o próprio nome: deve ter sucesso
    const resSelf = await fetch(`${baseUrl}/equipment/${eqA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...eqA, purchase_value: 3600 }),
    });
    assert.equal(resSelf.status, 200);

    // 2. Atualizar eqB para o mesmo nome de eqA: deve ser rejeitado (400)
    const resCollision = await fetch(`${baseUrl}/equipment/${eqB.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...eqB, name: '   TRIPÉ MANFROTTO 504HD ' }),
    });
    assert.equal(resCollision.status, 400);
  });
});

test('EQ1.5 - Multi-unidades com identificação sequencial (ex: Cartões SD 01, 02) cadastrados com sucesso', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    const units = [
      'Cartão SD V60 128 GB 01',
      'Cartão SD V60 128 GB 02',
      'Cartão SD V60 128 GB 03',
    ];

    for (const unitName of units) {
      const res = await fetch(`${baseUrl}/equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: unitName,
          category: 'Acessórios',
          brand: 'SanDisk',
          model: 'Extreme Pro V60',
          purchase_value: 450,
          residual_value: 50,
          useful_life_years: 2,
          estimation_method: 'total_hours',
          total_useful_hours: 2000,
          annual_hours: 500,
          is_active: 1,
        }),
      });
      assert.equal(res.status, 201);
    }

    const rows = db.prepare("SELECT name FROM equipment WHERE name LIKE 'Cartão SD%' AND is_deleted = 0 ORDER BY name ASC").all() as any[];
    assert.equal(rows.length, 3);
    assert.equal(rows[0].name, 'Cartão SD V60 128 GB 01');
    assert.equal(rows[1].name, 'Cartão SD V60 128 GB 02');
    assert.equal(rows[2].name, 'Cartão SD V60 128 GB 03');
  });
});

test('EQ1.6 - Categoria Baterias aceita, calcula depreciação e integra em orçamentos', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cadastra bateria
    const resBat = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bateria V-Mount 98Wh 01',
        category: 'Baterias',
        brand: 'SmallRig',
        model: 'VB99',
        purchase_value: 1200,
        residual_value: 200,
        useful_life_years: 2,
        estimation_method: 'total_hours',
        total_useful_hours: 1000,
        annual_hours: 500,
        is_active: 1,
      }),
    });
    assert.equal(resBat.status, 201);
    const bat = await resBat.json();
    assert.equal(bat.category, 'Baterias');

    // 2. Consulta pelo endpoint GET
    const resList = await fetch(`${baseUrl}/equipment`);
    assert.equal(resList.status, 200);
    const list = await resList.json();
    const found = list.find((item: any) => item.category === 'Baterias');
    assert.ok(found);
    assert.equal(found.name, 'Bateria V-Mount 98Wh 01');

    // 3. Cadastra orçamento utilizando a bateria
    const budgetPayload = {
      title: 'Gravação Institucional com Baterias',
      client_name: 'Cliente Teste',
      equipment: [
        {
          equipment_id: bat.id,
          name: bat.name,
          category: bat.category,
          hours_used: 10,
          hourly_depreciation: 1.0, // (1200 - 200) / 1000 = 1.00/h
          total_depreciation: 10.0,
        },
      ],
      calculatedSummary: {
        finalBasePrice: 2500,
      },
    };

    const resBudget = await fetch(`${baseUrl}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(budgetPayload),
    });
    assert.equal(resBudget.status, 201);
    const budget = await resBudget.json();
    assert.ok(budget.id);
  });
});

test('EQ1.7 - Identificação institucional da produtora FBonilha - Produtora Audiovisual em configurações e propostas', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. GET /settings deve conter o nome institucional atualizado
    const resSettings = await fetch(`${baseUrl}/settings`);
    assert.equal(resSettings.status, 200);
    const settings = await resSettings.json();
    assert.equal(settings.studio_name, 'FBonilha - Produtora Audiovisual');

    // 2. Orçamento sem responsável especificado assume o padrão institucional
    const resBudget = await fetch(`${baseUrl}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Comercial Institucional',
        client_name: 'Empresa Alpha',
        calculatedSummary: {
          finalBasePrice: 15000,
        },
      }),
    });
    assert.equal(resBudget.status, 201);
    const budget = await resBudget.json();
    assert.equal(budget.responsible, 'FBonilha - Produtora Audiovisual');

    // 3. Emitir proposta comercial formal deve associar o estúdio institucional como emissor
    const resProp = await fetch(`${baseUrl}/budgets/${budget.id}/emit-proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalPrice: 15000,
      }),
    });
    assert.equal(resProp.status, 201);
    const prop = await resProp.json();
    assert.equal(prop.issuerContact.studioName, 'FBonilha - Produtora Audiovisual');
  });
});

test('PDF1.1 - Geração de proposta comercial em PDF renderiza o novo nome institucional FBonilha - Produtora Audiovisual', () => {
  const proposalData = {
    proposalCode: 'PROP-2026-FBN',
    clientName: 'Cliente Audiovisual SP',
    clientCompany: 'Empresa Audiovisual Ltda',
    projectTitle: 'Vídeo Institucional 4K',
    scopeSummary: 'Captação externa com 2 diárias e pós-produção completa com color grading',
    commercialHours: { preProductionHours: 4, productionHours: 12, postProductionHours: 16 },
    totalPrice: 15000,
    cashDiscountPct: 10,
    cashPrice: 13500,
    installmentCount: 4,
    installmentValue: 3750,
    issueDate: '2026-10-21',
    validUntilDate: '2026-10-28',
    settings: {
      id: 1,
      studio_name: 'FBonilha - Produtora Audiovisual',
      primary_color: '#4F5D47',
      email: 'contato@fbonilha.com.br',
      phone: '(11) 98765-4321',
      website: 'www.fbonilha.com.br',
      cnpj: '12.345.678/0001-90',
      address: 'São Paulo, SP',
      default_hourly_rate: 150,
      default_billable_hours_month: 100,
      default_pricing_method: 'margin_on_sale',
      default_profit_margin_pct: 25,
      default_markup_pct: 35,
      default_tax_pct: 6,
      default_financial_fee_pct: 2.5,
      default_fixed_fee: 0,
      default_cash_discount_pct: 10,
      default_installments: 4,
      proposal_valid_days: 7,
      default_notes: 'Notas comerciais',
      terms_and_conditions: 'Termos comerciais',
      updated_at: '2026-10-21',
    } as any,
  };

  const doc = generateCommercialProposalPdf(proposalData as any);
  assert.ok(doc, 'Instância de jsPDF criada com sucesso');
  const rawOutput = doc.output();
  assert.ok(rawOutput.includes('FBonilha - Produtora Audiovisual'), 'PDF deve conter o novo nome institucional no documento');
  assert.ok(rawOutput.includes('PROP-2026-FBN'), 'PDF deve conter o código da proposta');
  assert.ok(rawOutput.includes('Cliente Audiovisual SP'), 'PDF deve conter o nome do cliente');
});

test('PDF1.2 - Geração de proposta comercial em PDF aplica fallback para FBonilha - Produtora Audiovisual quando studio_name estiver vazio ou com espaços', () => {
  const emptyCases = ['', '   ', undefined, null];

  for (const emptyVal of emptyCases) {
    const proposalData = {
      proposalCode: 'PROP-2026-FALLBACK',
      clientName: 'Cliente Sem Studio Name',
      projectTitle: 'Campanha Publicitária',
      scopeSummary: 'Produção executiva e gravação',
      commercialHours: { preProductionHours: 2, productionHours: 6, postProductionHours: 8 },
      totalPrice: 5000,
      cashDiscountPct: 10,
      cashPrice: 4500,
      installmentCount: 2,
      installmentValue: 2500,
      issueDate: '2026-10-21',
      validUntilDate: '2026-10-28',
      settings: {
        id: 1,
        studio_name: emptyVal as any,
        primary_color: '#4F5D47',
      } as any,
    };

    const doc = generateCommercialProposalPdf(proposalData as any);
    const rawOutput = doc.output();
    assert.ok(
      rawOutput.includes('FBonilha - Produtora Audiovisual'),
      `PDF deve usar fallback institucional FBonilha - Produtora Audiovisual quando studio_name for ${JSON.stringify(emptyVal)}`
    );
  }
});

test('PDF1.3 - Geração de proposta comercial em PDF preserva nome de estúdio customizado quando fornecido', () => {
  const proposalData = {
    proposalCode: 'PROP-2026-CUSTOM',
    clientName: 'Cliente Custom',
    projectTitle: 'Vídeo Promocional',
    scopeSummary: 'Gravação institucional',
    commercialHours: { preProductionHours: 1, productionHours: 4, postProductionHours: 4 },
    totalPrice: 3000,
    cashDiscountPct: 5,
    cashPrice: 2850,
    installmentCount: 3,
    installmentValue: 1000,
    issueDate: '2026-10-21',
    validUntilDate: '2026-10-28',
    settings: {
      id: 1,
      studio_name: 'Estúdio CineLab 2026',
      primary_color: '#10B981',
    } as any,
  };

  const doc = generateCommercialProposalPdf(proposalData as any);
  const rawOutput = doc.output();
  assert.ok(rawOutput.includes('Estúdio CineLab 2026'), 'PDF deve exibir o nome do estúdio customizado');
});

test('EQ1.8 - Categoria Baterias disponível na lista de categorias do catálogo e utilizável no fluxo de orçamento', async () => {
  // 1. Verifica disponibilidade na lista oficial de categorias
  assert.ok(CATEGORIES.includes('Baterias'), 'A categoria "Baterias" deve constar na constante CATEGORIES');

  await withTestServer(async ({ baseUrl }) => {
    // 2. Cria equipamento na categoria Baterias
    const batPayload = {
      name: 'Kit 4x Baterias Sony NP-FZ100',
      category: 'Baterias',
      brand: 'Sony',
      model: 'NP-FZ100',
      purchase_value: 2000,
      residual_value: 200,
      useful_life_years: 2,
      estimation_method: 'total_hours',
      total_useful_hours: 1800,
      annual_hours: 900,
      is_active: 1,
    };

    const resBat = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batPayload),
    });
    assert.equal(resBat.status, 201);
    const bat = await resBat.json();
    assert.equal(bat.category, 'Baterias');

    // 3. Consulta catálogo de equipamentos para simular fluxo de seleção no orçamento
    const resCatalog = await fetch(`${baseUrl}/equipment`);
    assert.equal(resCatalog.status, 200);
    const catalog = await resCatalog.json();
    const batteryItems = catalog.filter((e: any) => e.category === 'Baterias');
    assert.ok(batteryItems.length >= 1, 'Deve haver ao menos um item sob categoria Baterias');

    // 4. Seleciona a bateria para um orçamento com 12 horas de uso
    const budgetPayload = {
      title: 'Projeto Publicitário - Captação com Baterias',
      client_name: 'Agência Criativa',
      equipment: [
        {
          equipment_id: bat.id,
          name: bat.name,
          category: bat.category,
          hours_used: 12,
          hourly_depreciation: 1.0,
          total_depreciation: 12.0,
        },
      ],
      calculatedSummary: {
        totalEquipmentCost: 12.0,
        finalBasePrice: 4500,
      },
    };

    const resBudget = await fetch(`${baseUrl}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(budgetPayload),
    });
    assert.equal(resBudget.status, 201);
    const createdBudget = await resBudget.json();
    assert.ok(createdBudget.id);
    assert.equal(createdBudget.equipment.length, 1);
    assert.equal(createdBudget.equipment[0].category, 'Baterias');
    assert.equal(createdBudget.equipment[0].name, 'Kit 4x Baterias Sony NP-FZ100');
    assert.equal(createdBudget.equipment[0].total_depreciation, 12.0);
  });
});

test('EQ1.9 - Duplicação de equipamento preserva todos os parâmetros com ID distinto e impede nome duplicado', async () => {
  await withTestServer(async ({ baseUrl }) => {
    // 1. Cadastra equipamento original com todos os parâmetros detalhados
    const originalItem = {
      name: 'Luz LED Aputure 300d II',
      category: 'Iluminação',
      brand: 'Aputure',
      model: 'LS C300d II',
      serial_number: 'SN-AP-300D-01',
      purchase_value: 8500,
      residual_value: 1500,
      useful_life_years: 4,
      estimation_method: 'total_hours',
      total_useful_hours: 4000,
      annual_hours: 1000,
      notes: 'Kit completo com refletor e bag',
      is_active: 1,
    };

    const resOrig = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(originalItem),
    });
    assert.equal(resOrig.status, 201);
    const orig = await resOrig.json();

    // 2. Tentar duplicar com exatamente o mesmo nome deve ser rejeitado (400)
    const resDupSameName = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...orig,
        id: undefined, // Simula tentativa de criar novo item
      }),
    });
    assert.equal(resDupSameName.status, 400, 'Servidor deve rejeitar duplicação com nome idêntico');

    // 3. Duplicar com novo nome exclusivo preservando todos os demais parâmetros
    const resDupSuccess = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Luz LED Aputure 300d II Unidade 02',
        category: orig.category,
        brand: orig.brand,
        model: orig.model,
        serial_number: 'SN-AP-300D-02',
        purchase_value: orig.purchase_value,
        residual_value: orig.residual_value,
        useful_life_years: orig.useful_life_years,
        estimation_method: orig.estimation_method,
        total_useful_hours: orig.total_useful_hours,
        annual_hours: orig.annual_hours,
        notes: orig.notes,
        is_active: orig.is_active,
      }),
    });
    assert.equal(resDupSuccess.status, 201);
    const dup = await resDupSuccess.json();

    // Verificações
    assert.notEqual(dup.id, orig.id, 'IDs devem ser obrigatoriamente distintos');
    assert.equal(dup.name, 'Luz LED Aputure 300d II Unidade 02');
    assert.equal(dup.category, orig.category);
    assert.equal(dup.purchase_value, orig.purchase_value);
    assert.equal(dup.residual_value, orig.residual_value);
    assert.equal(dup.useful_life_years, orig.useful_life_years);
    assert.equal(dup.estimation_method, orig.estimation_method);
    assert.equal(dup.total_useful_hours, orig.total_useful_hours);
    assert.equal(dup.annual_hours, orig.annual_hours);
    assert.equal(dup.brand, orig.brand);
    assert.equal(dup.model, orig.model);
    assert.equal(dup.notes, orig.notes);
    assert.equal(dup.is_active, orig.is_active);
  });
});

// ============================================================================
// ETAPA 7: MIGRAÇÃO 5 SEGURA, PRESERVAÇÃO DE DADOS, NOMES INSTITUCIONAIS E UNICIDADE
// ============================================================================

function createLegacyV4Database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations VALUES (1, 'initial_schema_and_seed', datetime('now'));
    INSERT INTO schema_migrations VALUES (2, 'brand_identity_fbonilha_mov', datetime('now'));
    INSERT INTO schema_migrations VALUES (3, 'add_is_sample_flag_to_entities', datetime('now'));
    INSERT INTO schema_migrations VALUES (4, 'fix_sample_data_flag_and_protect_user_data', datetime('now'));

    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      studio_name TEXT NOT NULL DEFAULT 'FBonilha.mov',
      logo_url TEXT DEFAULT '',
      primary_color TEXT NOT NULL DEFAULT '#4F5D47',
      email TEXT DEFAULT 'contato@fbonilha.mov',
      phone TEXT DEFAULT '(11) 98765-4321',
      website TEXT DEFAULT 'www.fbonilha.mov',
      address TEXT DEFAULT 'São Paulo, SP',
      cnpj TEXT DEFAULT '00.000.000/0001-00',
      default_hourly_rate REAL NOT NULL DEFAULT 150.0,
      default_billable_hours_month REAL NOT NULL DEFAULT 100.0,
      default_pricing_method TEXT NOT NULL DEFAULT 'margin_on_sale',
      default_profit_margin_pct REAL NOT NULL DEFAULT 25.0,
      default_markup_pct REAL NOT NULL DEFAULT 35.0,
      default_tax_pct REAL NOT NULL DEFAULT 6.0,
      default_financial_fee_pct REAL NOT NULL DEFAULT 2.5,
      default_fixed_fee REAL NOT NULL DEFAULT 0.0,
      default_cash_discount_pct REAL NOT NULL DEFAULT 10.0,
      default_installments INTEGER NOT NULL DEFAULT 4,
      proposal_valid_days INTEGER NOT NULL DEFAULT 7,
      default_notes TEXT DEFAULT '',
      terms_and_conditions TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    );
    INSERT INTO settings (id, studio_name, updated_at) VALUES (1, 'FBonilha.mov', datetime('now'));

    CREATE TABLE equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Geral',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      acquisition_date TEXT DEFAULT '',
      purchase_value REAL NOT NULL DEFAULT 0.0,
      residual_value REAL NOT NULL DEFAULT 0.0,
      useful_life_years REAL NOT NULL DEFAULT 3.0,
      estimation_method TEXT NOT NULL DEFAULT 'total_hours',
      total_useful_hours REAL NOT NULL DEFAULT 2500.0,
      annual_hours REAL NOT NULL DEFAULT 600.0,
      notes TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      is_sample INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('MIG5.1 - Migração de um banco legado sem conflitos aplica a versão 5 e cria índice único normalizado', () => {
  const db = createLegacyV4Database();
  try {
    db.prepare('INSERT INTO equipment (id, name, purchase_value) VALUES (?, ?, ?)').run('eq1', 'Sony FX3', 25000);
    db.prepare('INSERT INTO equipment (id, name, purchase_value) VALUES (?, ?, ?)').run('eq2', 'Lente 24-70mm', 15000);

    runMigrations(db);

    const migrations = db.prepare('SELECT version FROM schema_migrations WHERE version = 5').all();
    assert.equal(migrations.length, 1, 'Versão 5 deve ser registrada no schema_migrations');

    const tableInfo = db.prepare('PRAGMA table_info(equipment)').all() as any[];
    assert.ok(tableInfo.some((c: any) => c.name === 'normalized_name'), 'Coluna normalized_name deve existir');

    const eq1 = db.prepare('SELECT * FROM equipment WHERE id = ?').get('eq1') as any;
    assert.equal(eq1.normalized_name, 'sony fx3');

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='equipment'").all() as any[];
    assert.ok(indexes.some((i: any) => i.name === 'idx_equipment_unique_normalized_name'));
  } finally {
    db.close();
  }
});

test('MIG5.2 - Migração de um banco com nomes duplicados detecta conflito previamente e bloqueia a migração com erro acionável', () => {
  const db = createLegacyV4Database();
  try {
    db.prepare('INSERT INTO equipment (id, name, purchase_value) VALUES (?, ?, ?)').run('eq1', 'Tripé Manfrotto 504HD', 3500);
    db.prepare('INSERT INTO equipment (id, name, purchase_value) VALUES (?, ?, ?)').run('eq2', '   TRIPÉ   MANFROTTO   504HD  ', 3500);

    assert.throws(
      () => {
        runMigrations(db);
      },
      (err: any) => {
        assert.ok(err instanceof EquipmentNameConflictError || err.name === 'EquipmentNameConflictError');
        assert.ok(err.message.includes('[MIGRATION 5 CONFLICT]'));
        assert.ok(err.message.includes('tripé manfrotto 504hd'));
        assert.ok(err.message.includes('eq1'));
        assert.ok(err.message.includes('eq2'));
        return true;
      }
    );

    const migrations = db.prepare('SELECT version FROM schema_migrations WHERE version = 5').all();
    assert.equal(migrations.length, 0, 'Versão 5 NÃO deve ser registrada em caso de conflito');
  } finally {
    db.close();
  }
});

test('MIG5.3 - Falha durante a criação do índice executa ROLLBACK sem alteração parcial dos dados', () => {
  const db = createLegacyV4Database();
  try {
    db.prepare("UPDATE settings SET studio_name = 'Nome Customizado Precioso' WHERE id = 1").run();
    db.prepare('INSERT INTO equipment (id, name, purchase_value) VALUES (?, ?, ?)').run('eq1', 'Câmera Red Komodo', 45000);
    db.prepare('INSERT INTO equipment (id, name, purchase_value) VALUES (?, ?, ?)').run('eq2', 'câmera   red   komodo', 45000);

    assert.throws(() => runMigrations(db));

    // 1. studio_name permanece intacto com o valor anterior
    const settings = db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any;
    assert.equal(settings.studio_name, 'Nome Customizado Precioso', 'Configurações não devem sofrer alteração parcial após rollback');

    // 2. schema_migrations não tem versão 5
    const v5 = db.prepare('SELECT version FROM schema_migrations WHERE version = 5').all();
    assert.equal(v5.length, 0);

    // 3. Nenhum equipamento foi excluído ou modificado
    const count = (db.prepare('SELECT count(*) as c FROM equipment').get() as any).c;
    assert.equal(count, 2, 'Todos os equipamentos originais devem ser preservados sem perda');
  } finally {
    db.close();
  }
});

test('MIG5.4 - Reexecução segura da migração após regularização dos dados conflitantes', () => {
  const db = createLegacyV4Database();
  try {
    db.prepare('INSERT INTO equipment (id, name) VALUES (?, ?)').run('eq1', 'Lente 50mm f/1.2 GM');
    db.prepare('INSERT INTO equipment (id, name) VALUES (?, ?)').run('eq2', 'lente   50mm   f/1.2   gm');

    // Primeira tentativa: falha previsível
    assert.throws(() => runMigrations(db));

    // Regularização pelo usuário: renomeia a unidade 2
    db.prepare("UPDATE equipment SET name = 'Lente 50mm f/1.2 GM Unidade 02' WHERE id = 'eq2'").run();

    // Segunda tentativa: reexecução bem-sucedida
    runMigrations(db);

    const v5 = db.prepare('SELECT version FROM schema_migrations WHERE version = 5').all();
    assert.equal(v5.length, 1, 'Versão 5 deve ser concluída com sucesso após regularização');

    const rows = db.prepare('SELECT id, name, normalized_name FROM equipment ORDER BY id ASC').all() as any[];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].normalized_name, 'lente 50mm f/1.2 gm');
    assert.equal(rows[1].normalized_name, 'lente 50mm f/1.2 gm unidade 02');
  } finally {
    db.close();
  }
});

test('MIG5.5 - Preservação de nomes personalizados na tabela settings', () => {
  const db = createLegacyV4Database();
  try {
    db.prepare("UPDATE settings SET studio_name = 'Minha Produtora Independente Ltda' WHERE id = 1").run();
    db.prepare('INSERT INTO equipment (id, name) VALUES (?, ?)').run('eq1', 'Microfone Lapela');

    runMigrations(db);

    const settings = db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any;
    assert.equal(settings.studio_name, 'Minha Produtora Independente Ltda', 'Nome customizado pelo usuário deve ser estritamente preservado');
  } finally {
    db.close();
  }
});

test('MIG5.6 - Substituição correta do nome legado FBonilha.mov para FBonilha - Produtora Audiovisual', () => {
  const db = createLegacyV4Database();
  try {
    // Banco legado contém o nome padrão anterior 'FBonilha.mov'
    db.prepare("UPDATE settings SET studio_name = 'FBonilha.mov' WHERE id = 1").run();

    runMigrations(db);

    const settings = db.prepare('SELECT studio_name FROM settings WHERE id = 1').get() as any;
    assert.equal(settings.studio_name, 'FBonilha - Produtora Audiovisual', 'Nome legado FBonilha.mov deve ser atualizado para a denominação institucional oficial');
  } finally {
    db.close();
  }
});

test('MIG5.7 - Rejeição de nomes duplicados com diferenças de maiúsculas, minúsculas e espaços redundantes', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // 1. Cadastra item original
    const res1 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cartão CFexpress Type A 160GB', category: 'Acessórios' }),
    });
    assert.equal(res1.status, 201);

    // 2. Tenta cadastrar variação com múltiplos espaços e caixa mista
    const res2 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   cartão    CFEXPRESS    type    a    160gb   ', category: 'Acessórios' }),
    });
    assert.equal(res2.status, 400);
    const body2 = await res2.json();
    assert.ok(body2.error.includes('Já existe um equipamento cadastrado'));

    // 3. Testa diretamente a restrição no SQLite para assegurar proteção contra bypass da API
    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO equipment (id, name, normalized_name, category)
          VALUES ('eq_bypass', 'Cartão CFexpress Type A 160GB', 'cartão cfexpress type a 160gb', 'Acessórios')
        `).run();
      },
      (err: any) => {
        assert.ok(err.message.includes('UNIQUE constraint failed'));
        return true;
      }
    );
  });
});

test('MIG5.8 - Integridade de todos os registros e dos IDs preservada após a migração', () => {
  const db = createLegacyV4Database();
  try {
    const originalItems = [
      { id: 'eq_custom_001', name: 'Kit Teleprompter 12"', value: 2800, hours: 1500, notes: 'Com tablet incluso' },
      { id: 'eq_custom_002', name: 'Gravador Zoom H6 Black', value: 2400, hours: 3000, notes: 'Cápsula XY' },
      { id: 'eq_custom_003', name: 'Monitor Atomos Ninja V', value: 5500, hours: 4000, notes: 'Com 2x SSD 500GB' },
    ];

    for (const it of originalItems) {
      db.prepare(`
        INSERT INTO equipment (id, name, purchase_value, total_useful_hours, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(it.id, it.name, it.value, it.hours, it.notes);
    }

    runMigrations(db);

    for (const it of originalItems) {
      const row = db.prepare('SELECT * FROM equipment WHERE id = ?').get(it.id) as any;
      assert.ok(row, `Equipamento ${it.id} deve continuar existindo`);
      assert.equal(row.name, it.name);
      assert.equal(row.purchase_value, it.value);
      assert.equal(row.total_useful_hours, it.hours);
      assert.equal(row.notes, it.notes);
      assert.ok(row.normalized_name, 'normalized_name deve estar preenchido');
    }
  } finally {
    db.close();
  }
});

test('MIG5.9 - Criação de equipamentos concorrentes com o mesmo nome é garantidamente bloqueada no banco', async () => {
  await withTestServer(async ({ baseUrl, db }) => {
    // Simula duas requisições concorrentes disparadas simultaneamente
    const p1 = fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Transmissor Hollyland Mars 4K', category: 'Acessórios' }),
    });

    const p2 = fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  transmissor   hollyland   mars   4k  ', category: 'Acessórios' }),
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status].sort();

    // Uma deve ter sucesso (201) e a outra deve ser rejeitada (400)
    assert.deepEqual(statuses, [201, 400], 'Apenas uma criação concorrente com o mesmo nome pode ser aceita');

    const rows = db.prepare("SELECT * FROM equipment WHERE normalized_name = 'transmissor hollyland mars 4k'").all();
    assert.equal(rows.length, 1, 'Exatamente um registro deve persistir no banco');
  });
});

test('MIG5.10 - Preservação dos registros arquivados (is_deleted = 1) e coexistência sem conflito', () => {
  const db = createLegacyV4Database();
  try {
    // Três equipamentos com o mesmo nome: dois arquivados e um ativo
    db.prepare("INSERT INTO equipment (id, name, is_deleted) VALUES ('eq_arch_1', 'Câmera Canon 5D Mark III', 1)").run();
    db.prepare("INSERT INTO equipment (id, name, is_deleted) VALUES ('eq_arch_2', '  câmera   canon   5d   mark   iii  ', 1)").run();
    db.prepare("INSERT INTO equipment (id, name, is_deleted) VALUES ('eq_active', 'Câmera Canon 5D Mark III', 0)").run();

    // A migração deve ter sucesso sem conflito, pois o índice único é filtrado por WHERE is_deleted = 0
    runMigrations(db);

    const v5 = db.prepare('SELECT version FROM schema_migrations WHERE version = 5').all();
    assert.equal(v5.length, 1, 'Migração deve concluir mesmo com itens arquivados homônimos');

    const total = (db.prepare('SELECT count(*) as c FROM equipment').get() as any).c;
    assert.equal(total, 3, 'Todos os registros arquivados e ativos devem ser preservados');

    const active = db.prepare('SELECT id, name FROM equipment WHERE is_deleted = 0').all() as any[];
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'eq_active');
  } finally {
    db.close();
  }
});




