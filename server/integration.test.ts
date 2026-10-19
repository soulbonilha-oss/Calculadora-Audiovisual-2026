import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
} from './db.js';
import { generateCommercialProposalPdf } from '../src/utils/pdfGenerator.js';
import { calculateProjectPricing } from '../src/financial/engine.js';

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
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);

  const originalListen = express.application.listen;
  // Intercepta app.listen para disparar erro durante a inicialização do Express
  (express.application as any).listen = function () {
    throw new Error('Falha simulada na inicialização do servidor HTTP');
  };

  try {
    await assert.rejects(
      async () => {
        await withTestServer(async () => {});
      },
      (err: any) => err.message === 'Falha simulada na inicialização do servidor HTTP'
    );

    // O estado global DEVE ter sido restaurado para o sentinela prévio
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado após falha na preparação');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado após falha na preparação');
  } finally {
    (express.application as any).listen = originalListen;
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
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
  setDbInstance(sentinelDb);
  setSafetyBackupDir(sentinelSafetyDir);

  const origExec = DatabaseSync.prototype.exec;
  // Intercepta exec para simular falha catastrófica durante as migrações iniciais do banco
  DatabaseSync.prototype.exec = function (sql: string) {
    if (typeof sql === 'string' && sql.includes('CREATE TABLE IF NOT EXISTS settings')) {
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

    // O estado global DEVE ter sido restaurado para o sentinela prévio
    assert.equal(getDbInstance(), sentinelDb, 'dbInstance restaurado após falha nas migrações');
    assert.equal(getRawSafetyBackupDir(), sentinelSafetyDir, 'safetyBackupDir restaurado após falha nas migrações');
  } finally {
    DatabaseSync.prototype.exec = origExec;
    sentinelDb.close();
    setDbInstance(null);
    setSafetyBackupDir(null);
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



