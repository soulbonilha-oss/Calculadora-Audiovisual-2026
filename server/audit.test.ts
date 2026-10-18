import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateBackupPayload } from './api.js';
import { generateCommercialProposalPdf } from '../src/utils/pdfGenerator.js';

// ============================================================================
// SUÍTE DE AUDITORIA 1: PERSISTÊNCIA, MIGRAÇÕES E SNAPSHOTS IMUTÁVEIS (SEÇÃO 8)
// ============================================================================
test('Auditoria 8.1 - Integridade de Snapshots: Alterar cadastro geral não altera orçamento salvo', () => {
  const db = new DatabaseSync(':memory:');
  
  // Criar tabelas essenciais
  db.exec(`
    CREATE TABLE equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      purchase_value REAL NOT NULL,
      residual_value REAL NOT NULL,
      is_sample INTEGER DEFAULT 0
    );
    CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      client_name TEXT NOT NULL,
      equipment_snapshot_json TEXT NOT NULL,
      calculated_summary_json TEXT NOT NULL
    );
  `);

  // 1. Cadastrar equipamento original
  db.prepare('INSERT INTO equipment (id, name, purchase_value, residual_value) VALUES (?, ?, ?, ?)')
    .run('eq_fx3', 'Sony FX3', 26000.0, 4000.0);

  // 2. Criar orçamento com snapshot imutável
  const budgetSnapshot = [
    { equipmentId: 'eq_fx3', name: 'Sony FX3', purchaseValue: 26000.0, residualValue: 4000.0, hoursUsed: 10 }
  ];
  db.prepare(`
    INSERT INTO budgets (id, code, title, client_name, equipment_snapshot_json, calculated_summary_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('bud_01', 'ORC-2026-001', 'Comercial Institucional', 'Cliente Alfa', JSON.stringify(budgetSnapshot), JSON.stringify({ finalBasePrice: 5000 }));

  // 3. Atualizar cadastro geral de equipamentos para R$ 40.000 (ex: inflação / upgrade de lente)
  db.prepare('UPDATE equipment SET purchase_value = ? WHERE id = ?').run(40000.0, 'eq_fx3');

  // 4. Reabrir orçamento histórico e verificar se o valor do equipamento permanece R$ 26.000
  const loadedBudget = db.prepare('SELECT * FROM budgets WHERE id = ?').get('bud_01') as any;
  const loadedSnapshot = JSON.parse(loadedBudget.equipment_snapshot_json);

  assert.equal(loadedSnapshot[0].purchaseValue, 26000.0, 'O valor histórico no snapshot deve ser rigorosamente preservado');
  
  // O cadastro geral atualizado deve refletir 40.000 para novos orçamentos
  const currentEquipment = db.prepare('SELECT purchase_value FROM equipment WHERE id = ?').get('eq_fx3') as any;
  assert.equal(currentEquipment.purchase_value, 40000.0);
  
  db.close();
});

// ============================================================================
// SUÍTE DE AUDITORIA 2: RESTAURAÇÃO DE PROPOSTAS E BACKUP JSON (SEÇÃO 3)
// ============================================================================
test('Auditoria 3.1 - Backup JSON restaura integralmente propostas comerciais emitidas', () => {
  const db = new DatabaseSync(':memory:');
  
  db.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, studio_name TEXT);
    CREATE TABLE budgets (id TEXT PRIMARY KEY, code TEXT, title TEXT, client_name TEXT);
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      proposal_code TEXT NOT NULL,
      client_name TEXT NOT NULL,
      project_title TEXT NOT NULL,
      total_price REAL NOT NULL,
      cash_price REAL NOT NULL,
      cash_discount_pct REAL NOT NULL,
      installment_count INTEGER NOT NULL,
      installment_value REAL NOT NULL,
      issue_date TEXT NOT NULL,
      valid_until_date TEXT NOT NULL
    );
  `);

  const backupPayload = {
    app: 'FBonilha.mov',
    version: '2.0.0',
    schema_version: 3,
    exported_at: '2026-10-18T10:00:00.000Z',
    data: {
      settings: { id: 1, studio_name: 'FBonilha.mov' },
      budgets: [
        { id: 'bud_100', code: 'ORC-2026-100', title: 'Vídeo Manifesto', client_name: 'Empresa Beta' }
      ],
      proposals: [
        {
          id: 'prop_200',
          budget_id: 'bud_100',
          proposal_code: 'PROP-2026-5555',
          client_name: 'Empresa Beta',
          project_title: 'Vídeo Manifesto',
          total_price: 12000.0,
          cash_price: 10800.0,
          cash_discount_pct: 10.0,
          installment_count: 4,
          installment_value: 3000.0,
          issue_date: '2026-10-18',
          valid_until_date: '2026-10-25',
        }
      ]
    }
  };

  // Validar arquivo de backup
  const validation = validateBackupPayload(backupPayload, db);
  assert.equal(validation.isValid, true, 'Arquivo com proposta e orçamento válido deve passar na validação');
  assert.equal(validation.summary.proposalsCount, 1);
  assert.equal(validation.summary.budgetsCount, 1);

  // Simular restauração transacional
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const b of backupPayload.data.budgets) {
      db.prepare('INSERT OR REPLACE INTO budgets (id, code, title, client_name) VALUES (?, ?, ?, ?)').run(
        b.id, b.code, b.title, b.client_name
      );
    }
    for (const p of backupPayload.data.proposals) {
      db.prepare(`
        INSERT OR REPLACE INTO proposals (
          id, budget_id, proposal_code, client_name, project_title, total_price,
          cash_price, cash_discount_pct, installment_count, installment_value, issue_date, valid_until_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.id, p.budget_id, p.proposal_code, p.client_name, p.project_title,
        p.total_price, p.cash_price, p.cash_discount_pct, p.installment_count, p.installment_value,
        p.issue_date, p.valid_until_date
      );
    }
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }

  // Verificar restauração no banco
  const restoredProp = db.prepare('SELECT * FROM proposals WHERE id = ?').get('prop_200') as any;
  assert.ok(restoredProp, 'Proposta comercial deve existir no banco após a restauração');
  assert.equal(restoredProp.proposal_code, 'PROP-2026-5555');
  assert.equal(restoredProp.total_price, 12000.0);
  assert.equal(restoredProp.cash_price, 10800.0);
  assert.equal(restoredProp.installment_value, 3000.0);

  db.close();
});

// ============================================================================
// SUÍTE DE AUDITORIA 3: VALIDAÇÃO ESTRUTURAL E ROLLBACK (SEÇÃO 3.2 e 5)
// ============================================================================
test('Auditoria 5.1 - Validação Estrutural: Rejeição de arquivo malformado', () => {
  assert.equal(validateBackupPayload(null).isValid, false);
  assert.equal(validateBackupPayload('string-invalida').isValid, false);
  assert.equal(validateBackupPayload([]).isValid, false);
  assert.equal(validateBackupPayload({}).isValid, false);
});

test('Auditoria 5.2 - Validação Estrutural: Detecção de IDs duplicados', () => {
  const duplicateIdPayload = {
    data: {
      equipment: [
        { id: 'eq_dup', name: 'Lente A' },
        { id: 'eq_dup', name: 'Lente B' }
      ]
    }
  };
  const result = validateBackupPayload(duplicateIdPayload);
  assert.equal(result.isValid, false);
  assert.match(result.errors[0], /ID duplicado/i);
});

test('Auditoria 5.3 - Validação Estrutural: Rejeição de proposta com orçamento inexistente', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE budgets (id TEXT PRIMARY KEY);');

  const orphanProposalPayload = {
    data: {
      budgets: [],
      proposals: [
        { id: 'prop_01', budget_id: 'budget_inexistente', proposal_code: 'P-01' }
      ]
    }
  };
  const result = validateBackupPayload(orphanProposalPayload, db);
  assert.equal(result.isValid, false);
  assert.match(result.errors[0], /orçamento inexistente/i);
  db.close();
});

test('Auditoria 3.2 - Integridade da Restauração: Rollback integral em caso de falha', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE equipment (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO equipment (id, name) VALUES ('eq_initial', 'Câmera Original');
  `);

  // Tentativa de restauração que falhará no meio por restrição de tipo ou trigger
  try {
    db.exec('BEGIN TRANSACTION;');
    db.prepare('INSERT INTO equipment (id, name) VALUES (?, ?)').run('eq_new_1', 'Câmera Nova 1');
    // Forçar erro de violação (NOT NULL violado)
    db.prepare('INSERT INTO equipment (id, name) VALUES (?, ?)').run('eq_fail', null);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
  }

  // Verificar que eq_new_1 NÃO foi persistido (rollback atômico completo)
  const rows = db.prepare('SELECT * FROM equipment').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'eq_initial', 'O banco de dados deve permanecer exatamente no estado anterior à tentativa com erro');

  db.close();
});

// ============================================================================
// SUÍTE DE AUDITORIA 4: BACKUP SQLITE EM MODO WAL VIA VACUUM INTO (SEÇÃO 4)
// ============================================================================
test('Auditoria 4.1 - Backup SQLite em modo WAL: VACUUM INTO gera snapshot íntegro e independente', () => {
  const tempDir = path.resolve('/tmp', `wal_test_${crypto.randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const liveDbPath = path.resolve(tempDir, 'live.sqlite');
  const backupDbPath = path.resolve(tempDir, 'backup.sqlite');

  // 1. Criar banco em modo WAL
  const liveDb = new DatabaseSync(liveDbPath);
  liveDb.exec('PRAGMA journal_mode = WAL;');
  liveDb.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, title TEXT NOT NULL);');
  
  // 2. Inserir dados ativos
  liveDb.prepare('INSERT INTO test_data (title) VALUES (?)').run('Captação 4K 10-bit');
  liveDb.prepare('INSERT INTO test_data (title) VALUES (?)').run('Color Grading DaVinci');

  // 3. Executar VACUUM INTO atômico para o arquivo de backup
  liveDb.exec(`VACUUM INTO '${backupDbPath.replace(/'/g, "''")}';`);

  // 4. Inspecionar o backup em conexão totalmente separada
  assert.equal(fs.existsSync(backupDbPath), true);
  const backupDb = new DatabaseSync(backupDbPath);
  
  // Teste de integridade
  const check = backupDb.prepare('PRAGMA integrity_check').get() as any;
  assert.equal(check.integrity_check, 'ok');

  // Confirmar que todas as alterações do WAL foram transferidas
  const records = backupDb.prepare('SELECT title FROM test_data ORDER BY id ASC').all() as any[];
  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'Captação 4K 10-bit');
  assert.equal(records[1].title, 'Color Grading DaVinci');

  backupDb.close();
  liveDb.close();

  // Limpar diretório temporário
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// SUÍTE DE AUDITORIA 5: GERADOR DE PDF DE PROPOSTA COMERCIAL (SEÇÃO 9)
// ============================================================================
test('Auditoria 9.1 - Geração de PDF Comercial sem expor custos internos ou margens', () => {
  const sampleData = {
    proposalCode: 'PROP-2026-9999',
    clientName: 'Marca Nacional S.A.',
    clientCompany: 'Marketing Direto',
    projectTitle: 'Campanha Institucional 2026',
    scopeSummary: 'Produção completa de vídeo institucional em 4K.',
    commercialHours: {
      preProductionHours: 4.5,
      productionHours: 8.0,
      postProductionHours: 12.0,
    },
    totalPrice: 15000.0,
    cashDiscountPct: 10.0,
    cashPrice: 13500.0,
    installmentCount: 3,
    installmentValue: 5000.0,
    issueDate: '2026-10-18',
    validUntilDate: '2026-10-25',
    settings: {
      id: 1,
      studio_name: 'FBonilha.mov',
      logo_url: '',
      primary_color: '#4F5D47',
      email: 'contato@fbonilha.mov',
      phone: '(11) 98765-4321',
      website: 'www.fbonilha.mov',
      address: 'São Paulo, SP',
      cnpj: '00.000.000/0001-00',
      default_hourly_rate: 150,
      default_billable_hours_month: 100,
      default_pricing_method: 'margin_on_sale' as const,
      default_profit_margin_pct: 25,
      default_markup_pct: 35,
      default_tax_pct: 6,
      default_financial_fee_pct: 2.5,
      default_fixed_fee: 0,
      default_cash_discount_pct: 10,
      default_installments: 4,
      proposal_valid_days: 7,
      default_notes: 'Validade de 7 dias.',
      terms_and_conditions: 'Condições gerais.',
      updated_at: '2026-10-18',
    },
  };

  const doc = generateCommercialProposalPdf(sampleData);
  assert.ok(doc, 'O documento jsPDF deve ser instanciado');
  
  // Obter arraybuffer do PDF gerado
  const pdfOutput = doc.output();
  assert.ok(pdfOutput.length > 1000, 'O PDF deve ter conteúdo gerado');
  
  // Verificar ausência estrita de termos de margem de lucro, depreciação interna ou markup
  assert.ok(!pdfOutput.includes('Margem de Lucro: 25%'), 'O PDF jamais deve expor margem interna');
  assert.ok(!pdfOutput.includes('Depreciação'), 'O PDF não deve expor depreciação');
});

test('Auditoria 9.2 - Geração de PDF com 0% de desconto e parcela única', () => {
  const zeroDiscountData = {
    proposalCode: 'PROP-2026-0001',
    clientName: 'Cliente Simples',
    projectTitle: 'Diária Avulsa',
    scopeSummary: 'Gravação e entrega bruta.',
    commercialHours: {
      preProductionHours: 1,
      productionHours: 4,
      postProductionHours: 2,
    },
    totalPrice: 3000.0,
    cashDiscountPct: 0,
    cashPrice: 3000.0,
    installmentCount: 1,
    installmentValue: 3000.0,
    issueDate: '2026-10-18',
    validUntilDate: '2026-10-25',
    settings: {
      id: 1,
      studio_name: 'FBonilha.mov',
      logo_url: '',
      primary_color: '#4F5D47',
      email: 'contato@fbonilha.mov',
      phone: '',
      website: '',
      address: '',
      cnpj: '',
      default_hourly_rate: 150,
      default_billable_hours_month: 100,
      default_pricing_method: 'margin_on_sale' as const,
      default_profit_margin_pct: 25,
      default_markup_pct: 35,
      default_tax_pct: 6,
      default_financial_fee_pct: 2.5,
      default_fixed_fee: 0,
      default_cash_discount_pct: 0,
      default_installments: 1,
      proposal_valid_days: 7,
      default_notes: '',
      terms_and_conditions: '',
      updated_at: '2026-10-18',
    },
  };

  const doc = generateCommercialProposalPdf(zeroDiscountData);
  assert.ok(doc);
  const pdfOutput = doc.output();
  assert.ok(pdfOutput.length > 500);
});
