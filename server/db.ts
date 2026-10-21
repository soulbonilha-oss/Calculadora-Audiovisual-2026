import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const DB_PATH = path.join(DB_DIR, 'fbonilha.sqlite');

export const CANONICAL_SAMPLE_IDS = {
  equipment: [
    'eq_camera_fx3',
    'eq_lens_2470',
    'eq_light_300d',
    'eq_audio_rode_pro',
    'eq_gimbal_rs3',
    'eq_tripod_manfrotto',
  ],
  recurring_expenses: [
    'rec_internet',
    'rec_accounting',
    'rec_adobe',
    'rec_cloud_storage',
    'rec_studio_energy',
    'rec_gear_insurance',
  ],
  expense_catalog: [
    'cat_music',
    'cat_hard_drive',
    'cat_van_transport',
    'cat_catering',
    'cat_drone_permit',
  ],
  professionals: [
    'pro_assistant',
    'pro_audio',
    'pro_drone',
    'pro_colorist',
    'pro_motion',
  ],
  production_templates: [
    'tpl_social_reels',
    'tpl_corporate_video',
  ],
} as const;

let dbInstance: DatabaseSync | null = null;
let explicitTestMode: boolean | null = null;

export function setTestMode(active: boolean | null): void {
  explicitTestMode = active;
}

export function getTestMode(): boolean | null {
  return explicitTestMode;
}

export function isTestEnvironment(): boolean {
  if (explicitTestMode !== null) {
    return explicitTestMode;
  }
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test') ||
    process.argv.some((arg) => arg.includes('.test.ts') || arg.includes('.spec.ts'))
  );
}

export function setDbInstance(db: DatabaseSync | null): void {
  dbInstance = db;
}

export function getDbInstance(): DatabaseSync | null {
  return dbInstance;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    if (isTestEnvironment()) {
      throw new Error(
        '[TEST GUARD] Tentativa não autorizada de acessar o banco de dados persistente real (DB_PATH) em ambiente de teste. Todo teste deve utilizar uma instância isolada com withTestServer() ou setDbInstance().'
      );
    }
    dbInstance = new DatabaseSync(DB_PATH);
    (dbInstance as any).__isPersistentProductionDb = true;
    // Habilitar WAL mode e foreign keys
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    runMigrations(dbInstance);
  }
  return dbInstance;
}

export function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  if (!appliedVersions.has(1)) {
    db.exec(`
      -- Configurações gerais da produtora
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        studio_name TEXT NOT NULL DEFAULT 'FBonilha - Produtora Audiovisual',
        logo_url TEXT DEFAULT '',
        primary_color TEXT NOT NULL DEFAULT '#059669',
        email TEXT DEFAULT 'contato@fbonilha.com.br',
        phone TEXT DEFAULT '(11) 98765-4321',
        website TEXT DEFAULT 'www.fbonilha.com.br',
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
        default_notes TEXT DEFAULT 'Proposta válida por 7 dias corridos. Condições comerciais sujeitas à disponibilidade de agenda.',
        terms_and_conditions TEXT DEFAULT 'Formas de pagamento: À vista com 10% de desconto ou em até 4x sem juros. Direitos de uso conforme escopo acordado.',
        updated_at TEXT NOT NULL
      );

      -- Cadastro de Equipamentos
      CREATE TABLE IF NOT EXISTS equipment (
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

      -- Custos Fixos Mensais (Rateio)
      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Geral',
        monthly_value REAL NOT NULL DEFAULT 0.0,
        start_date TEXT DEFAULT '',
        end_date TEXT DEFAULT '',
        accounting_method TEXT NOT NULL DEFAULT 'overhead_allocated',
        notes TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_sample INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Catálogo de Despesas, Serviços e Materiais Extras
      CREATE TABLE IF NOT EXISTS expense_catalog (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Geral',
        description TEXT DEFAULT '',
        cost_type TEXT NOT NULL DEFAULT 'per_project',
        default_value REAL NOT NULL DEFAULT 0.0,
        periodicity TEXT DEFAULT 'project',
        accounting_method TEXT NOT NULL DEFAULT 'direct_project',
        notes TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_sample INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Profissionais e Terceirizados
      CREATE TABLE IF NOT EXISTS professionals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        specialty TEXT NOT NULL DEFAULT 'Geral',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        hiring_type TEXT NOT NULL DEFAULT 'daily',
        default_value REAL NOT NULL DEFAULT 0.0,
        notes TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_sample INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Modelos Reutilizáveis de Produção
      CREATE TABLE IF NOT EXISTS production_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        stages_json TEXT NOT NULL DEFAULT '[]',
        equipment_json TEXT NOT NULL DEFAULT '[]',
        professionals_json TEXT NOT NULL DEFAULT '[]',
        expenses_json TEXT NOT NULL DEFAULT '[]',
        pricing_config_json TEXT NOT NULL DEFAULT '{}',
        notes TEXT DEFAULT '',
        is_sample INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Orçamentos com Snapshots Imutáveis
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_company TEXT DEFAULT '',
        client_email TEXT DEFAULT '',
        client_phone TEXT DEFAULT '',
        description TEXT DEFAULT '',
        scope_summary TEXT DEFAULT '',
        internal_notes TEXT DEFAULT '',
        responsible TEXT DEFAULT 'FBonilha',
        status TEXT NOT NULL DEFAULT 'draft',
        template_id TEXT DEFAULT NULL,
        stages_snapshot_json TEXT NOT NULL DEFAULT '[]',
        equipment_snapshot_json TEXT NOT NULL DEFAULT '[]',
        professionals_snapshot_json TEXT NOT NULL DEFAULT '[]',
        expenses_snapshot_json TEXT NOT NULL DEFAULT '[]',
        pricing_config_json TEXT NOT NULL DEFAULT '{}',
        calculated_summary_json TEXT NOT NULL DEFAULT '{}',
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Propostas Comerciais Emitidas
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        proposal_code TEXT NOT NULL,
        client_name TEXT NOT NULL,
        project_title TEXT NOT NULL,
        scope_summary TEXT DEFAULT '',
        stage_hours_summary_json TEXT NOT NULL DEFAULT '{}',
        total_price REAL NOT NULL,
        cash_price REAL NOT NULL,
        cash_discount_pct REAL NOT NULL DEFAULT 10.0,
        installment_count INTEGER NOT NULL DEFAULT 4,
        installment_value REAL NOT NULL,
        issue_date TEXT NOT NULL,
        valid_until_date TEXT NOT NULL,
        issuer_contact_json TEXT NOT NULL DEFAULT '{}',
        commercial_terms TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (budget_id) REFERENCES budgets (id)
      );
    `);

    // Inserir registro inicial de settings se não existir
    const existingSettings = db.prepare('SELECT id FROM settings WHERE id = 1').get();
    if (!existingSettings) {
      db.prepare(`
        INSERT INTO settings (id, updated_at) VALUES (1, datetime('now'))
      `).run();
    }

    // Seed inicial com equipamentos e itens do mundo real da FBonilha
    seedInitialData(db);

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))')
      .run(1, 'initial_schema_and_seed');
  }

  if (!appliedVersions.has(2)) {
    db.exec(`
      UPDATE settings SET
        studio_name = 'FBonilha.mov',
        primary_color = '#4F5D47',
        email = 'contato@fbonilha.mov',
        website = 'www.fbonilha.mov',
        default_notes = 'Estratégia antes da câmera. Intenção em cada conteúdo. Proposta válida por 7 dias corridos.',
        terms_and_conditions = 'Formas de pagamento: À vista com 10% de desconto ou em até 4x sem juros. A produção audiovisual e os direitos de uso são estritamente alinhados ao escopo acordado.',
        updated_at = datetime('now')
      WHERE id = 1;
    `);

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))')
      .run(2, 'brand_identity_fbonilha_mov');
  }

  if (!appliedVersions.has(3)) {
    // Migration 3: Separação explícita de dados de demonstração vs dados reais do usuário
    const tables = ['equipment', 'recurring_expenses', 'expense_catalog', 'professionals', 'production_templates'];
    for (const table of tables) {
      const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
      const hasIsSample = tableInfo.some((col: any) => col.name === 'is_sample');
      if (!hasIsSample) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;`);
      }
    }

    // Marcar exclusivamente registros canônicos oficiais com is_sample = 1 (nunca prefixos genéricos)
    for (const [table, ids] of Object.entries(CANONICAL_SAMPLE_IDS)) {
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(`UPDATE ${table} SET is_sample = 1 WHERE id IN (${placeholders})`).run(...ids);
    }

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))')
      .run(3, 'add_is_sample_flag_to_entities');
  }

  if (!appliedVersions.has(4)) {
    // Migration 4: Proteção rigorosa de cadastros reais do usuário contra classificações errôneas por prefixo.
    // NENHUM registro é classificado como demonstrativo exclusivamente pelo prefixo de ID.
    // Cadastros reais criados pelo usuário (ex: eq_teste_real, pro_equipe, tpl_modelo) ou desconhecidos
    // têm is_sample = 0. Apenas os IDs oficiais canônicos mantêm is_sample = 1.
    for (const [table, ids] of Object.entries(CANONICAL_SAMPLE_IDS)) {
      const placeholders = ids.map(() => '?').join(', ');
      // 1. Zera is_sample para qualquer registro que NÃO esteja na lista canônica oficial
      db.prepare(`UPDATE ${table} SET is_sample = 0 WHERE id NOT IN (${placeholders})`).run(...ids);
      // 2. Garante is_sample = 1 exclusivamente para os IDs canônicos oficiais
      db.prepare(`UPDATE ${table} SET is_sample = 1 WHERE id IN (${placeholders})`).run(...ids);
    }

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))')
      .run(4, 'fix_sample_data_flag_and_protect_user_data');
  }

  if (!appliedVersions.has(5)) {
    // Migration 5: Atualização institucional do nome da produtora para 'FBonilha - Produtora Audiovisual'
    // e criação de índice exclusivo para nomes de equipamentos ativos
    db.exec(`
      UPDATE settings SET
        studio_name = 'FBonilha - Produtora Audiovisual',
        updated_at = datetime('now')
      WHERE id = 1;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_unique_name
      ON equipment (LOWER(TRIM(name)))
      WHERE is_deleted = 0;
    `);

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime(\'now\'))')
      .run(5, 'update_studio_name_and_equipment_unique_index');
  }
}

export function clearSampleData(db: DatabaseSync) {
  if (isTestEnvironment() && (db as any).__isPersistentProductionDb) {
    throw new Error('[TEST GUARD] Operação destrutiva bloqueada: clearSampleData não pode ser executada contra o banco persistente real em ambiente de teste.');
  }
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const [table, ids] of Object.entries(CANONICAL_SAMPLE_IDS)) {
      const placeholders = ids.map(() => '?').join(', ');
      // Exclui SOMENTE registros canônicos demonstrativos comprovados
      db.prepare(`DELETE FROM ${table} WHERE is_sample = 1 AND id IN (${placeholders})`).run(...ids);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function listSampleData(db: DatabaseSync): Array<{ table: string; categoryLabel: string; id: string; name: string }> {
  const result: Array<{ table: string; categoryLabel: string; id: string; name: string }> = [];
  const tableLabels: Record<string, string> = {
    equipment: 'Equipamento',
    recurring_expenses: 'Custo Fixo',
    expense_catalog: 'Catálogo de Despesas',
    professionals: 'Equipe / Profissional',
    production_templates: 'Modelo de Orçamento',
  };

  for (const [table, ids] of Object.entries(CANONICAL_SAMPLE_IDS)) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT id, name FROM ${table} WHERE is_sample = 1 AND id IN (${placeholders})`).all(...ids) as any[];
    for (const r of rows) {
      result.push({
        table,
        categoryLabel: tableLabels[table] || table,
        id: r.id,
        name: r.name,
      });
    }
  }
  return result;
}

export function restoreSampleData(db: DatabaseSync) {
  if (process.env.NODE_ENV === 'test' && (db as any).__isPersistentProductionDb) {
    throw new Error('[TEST GUARD] Operação destrutiva bloqueada: restoreSampleData não pode ser executada contra o banco persistente real em ambiente de teste.');
  }
  seedInitialData(db);
}

function seedInitialData(db: DatabaseSync) {
  const now = new Date().toISOString();

  // Equipamentos de padrão audiovisual profissional
  const initialEquipment = [
    {
      id: 'eq_camera_fx3',
      name: 'Cinema Camera Sony FX3 (Full Frame)',
      category: 'Câmeras',
      brand: 'Sony',
      model: 'ILME-FX3',
      purchase_value: 26000.0,
      residual_value: 4000.0,
      useful_life_years: 3,
      estimation_method: 'total_hours',
      total_useful_hours: 2500,
      annual_hours: 800,
      notes: 'Corpo principal para captação 4K 120p ProRes RAW',
    },
    {
      id: 'eq_lens_2470',
      name: 'Lente Sony GM 24-70mm f/2.8 II',
      category: 'Lentes',
      brand: 'Sony',
      model: 'FE 24-70mm GM II',
      purchase_value: 14500.0,
      residual_value: 3500.0,
      useful_life_years: 5,
      estimation_method: 'total_hours',
      total_useful_hours: 4000,
      annual_hours: 800,
      notes: 'Lente zoom versátil para entrevistas e eventos',
    },
    {
      id: 'eq_light_300d',
      name: 'Iluminador LED Aputure Light Storm 300d II',
      category: 'Iluminação',
      brand: 'Aputure',
      model: 'LS 300d II',
      purchase_value: 8500.0,
      residual_value: 1200.0,
      useful_life_years: 4,
      estimation_method: 'total_hours',
      total_useful_hours: 3000,
      annual_hours: 750,
      notes: 'Luz principal com softbox Light Dome II',
    },
    {
      id: 'eq_audio_rode_pro',
      name: 'Kit Microfone Sem Fio Rode Wireless PRO (32-bit float)',
      category: 'Áudio',
      brand: 'Røde',
      model: 'Wireless PRO',
      purchase_value: 3400.0,
      residual_value: 500.0,
      useful_life_years: 3,
      estimation_method: 'total_hours',
      total_useful_hours: 2000,
      annual_hours: 600,
      notes: 'Gravação onboard e lapelas de alta sensibilidade',
    },
    {
      id: 'eq_gimbal_rs3',
      name: 'Estabilizador Gimbal DJI RS3 Pro Combo',
      category: 'Estabilização',
      brand: 'DJI',
      model: 'RS 3 Pro',
      purchase_value: 7200.0,
      residual_value: 1000.0,
      useful_life_years: 3,
      estimation_method: 'total_hours',
      total_useful_hours: 2000,
      annual_hours: 600,
      notes: 'Braços de fibra de carbono para câmera cinema',
    },
    {
      id: 'eq_tripod_manfrotto',
      name: 'Tripé com Cabeça Hidráulica Manfrotto 504X',
      category: 'Tripés',
      brand: 'Manfrotto',
      model: '504X + 645 FAST',
      purchase_value: 6800.0,
      residual_value: 1800.0,
      useful_life_years: 6,
      estimation_method: 'total_hours',
      total_useful_hours: 5000,
      annual_hours: 800,
      notes: 'Suporte de alta precisão para movimentos fluidos',
    },
  ];

  const insertEq = db.prepare(`
    INSERT OR IGNORE INTO equipment (
      id, name, category, brand, model, purchase_value, residual_value,
      useful_life_years, estimation_method, total_useful_hours, annual_hours,
      notes, is_active, is_sample, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `);

  for (const eq of initialEquipment) {
    insertEq.run(
      eq.id,
      eq.name,
      eq.category,
      eq.brand,
      eq.model,
      eq.purchase_value,
      eq.residual_value,
      eq.useful_life_years,
      eq.estimation_method,
      eq.total_useful_hours,
      eq.annual_hours,
      eq.notes,
      now,
      now
    );
  }

  // Custos Fixos Mensais recorrentes da produtora
  const initialRecurring = [
    { id: 'rec_internet', name: 'Internet Fibra Óptica 1Gbps Dedicado', category: 'Conectividade', monthly_value: 320.0 },
    { id: 'rec_accounting', name: 'Assessoria Contábil Especializada', category: 'Administrativo', monthly_value: 650.0 },
    { id: 'rec_adobe', name: 'Adobe Creative Cloud (Pacote Completo)', category: 'Softwares', monthly_value: 390.0 },
    { id: 'rec_cloud_storage', name: 'Armazenamento em Nuvem & Backup (Dropbox / Google Workspace)', category: 'Armazenamento', monthly_value: 280.0 },
    { id: 'rec_studio_energy', name: 'Energia & Ilha de Edição', category: 'Infraestrutura', monthly_value: 450.0 },
    { id: 'rec_gear_insurance', name: 'Seguro de Equipamentos Audiovisuais', category: 'Segurança', monthly_value: 850.0 },
  ];

  const insertRec = db.prepare(`
    INSERT OR IGNORE INTO recurring_expenses (
      id, name, category, monthly_value, accounting_method, is_active, is_sample, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'overhead_allocated', 1, 1, ?, ?)
  `);

  for (const rec of initialRecurring) {
    insertRec.run(rec.id, rec.name, rec.category, rec.monthly_value, now, now);
  }

  // Catálogo de Despesas Extras & Serviços
  const initialCatalog = [
    { id: 'cat_music', name: 'Licença Musical Comercial (Artlist / Musicbed)', category: 'Licenças', cost_type: 'per_project', default_value: 180.0 },
    { id: 'cat_hard_drive', name: 'SSD Portátil SanDisk Extreme 1TB para Entrega Raw', category: 'Materiais', cost_type: 'per_project', default_value: 650.0 },
    { id: 'cat_van_transport', name: 'Transporte e Combustível (Deslocamento Local)', category: 'Logística', cost_type: 'per_project', default_value: 250.0 },
    { id: 'cat_catering', name: 'Alimentação da Equipe em Diária de Gravação', category: 'Alimentação', cost_type: 'per_unit', default_value: 70.0 },
    { id: 'cat_drone_permit', name: 'Homologação e Autorização DECEA / SARPAS para Drone', category: 'Autorizações', cost_type: 'per_project', default_value: 120.0 },
  ];

  const insertCat = db.prepare(`
    INSERT OR IGNORE INTO expense_catalog (
      id, name, category, cost_type, default_value, accounting_method, is_active, is_sample, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'direct_project', 1, 1, ?, ?)
  `);

  for (const c of initialCatalog) {
    insertCat.run(c.id, c.name, c.category, c.cost_type, c.default_value, now, now);
  }

  // Profissionais e Terceirizados
  const initialPros = [
    { id: 'pro_assistant', name: 'Assistente de Câmera / Logger', specialty: 'Assistente de câmera', hiring_type: 'daily', default_value: 550.0, phone: '(11) 99123-4567' },
    { id: 'pro_audio', name: 'Técnico de Som Direto', specialty: 'Operador de áudio', hiring_type: 'daily', default_value: 750.0, phone: '(11) 98234-5678' },
    { id: 'pro_drone', name: 'Operador de Drone Certificado ANAC', specialty: 'Operador de drone', hiring_type: 'daily', default_value: 900.0, phone: '(11) 97345-6789' },
    { id: 'pro_colorist', name: 'Colorista Profissional (DaVinci Resolve)', specialty: 'Colorista', hiring_type: 'fixed', default_value: 1200.0, phone: '(11) 96456-7890' },
    { id: 'pro_motion', name: 'Motion Designer (Vinhetas & Cartelas)', specialty: 'Motion designer', hiring_type: 'fixed', default_value: 800.0, phone: '(11) 95567-8901' },
  ];

  const insertPro = db.prepare(`
    INSERT OR IGNORE INTO professionals (
      id, name, specialty, hiring_type, default_value, phone, is_active, is_sample, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `);

  for (const p of initialPros) {
    insertPro.run(p.id, p.name, p.specialty, p.hiring_type, p.default_value, p.phone, now, now);
  }

  // Modelos Reutilizáveis de Produção
  const initialTemplates = [
    {
      id: 'tpl_social_reels',
      name: 'Pacote Mensal de Reels / Shorts para Redes Sociais',
      description: 'Captação otimizada para até 8 vídeos verticais com iluminação portátil e roteiro dinâmico.',
      stages: [
        { id: 's1', name: 'Alinhamento de Roteiros e Ideação', hours: 3, hourlyRate: 150, commercialGroup: 'pre', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's2', name: 'Captação em Estúdio ou Locação (1 Diária)', hours: 6, hourlyRate: 150, commercialGroup: 'prod', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's3', name: 'Decupagem e Edição Dinâmica dos 8 Vídeos', hours: 12, hourlyRate: 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's4', name: 'Color Grading e Tratamento de Áudio', hours: 4, hourlyRate: 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's5', name: 'Legendas Animadas e Finalização', hours: 4, hourlyRate: 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
      ],
      equipment: [
        { equipmentId: 'eq_camera_fx3', name: 'Cinema Camera Sony FX3 (Full Frame)', hoursUsed: 6, hourlyDepreciation: 8.8, additionalRentalCost: 0 },
        { equipmentId: 'eq_lens_2470', name: 'Lente Sony GM 24-70mm f/2.8 II', hoursUsed: 6, hourlyDepreciation: 2.75, additionalRentalCost: 0 },
        { equipmentId: 'eq_audio_rode_pro', name: 'Kit Microfone Sem Fio Rode Wireless PRO', hoursUsed: 6, hourlyDepreciation: 1.45, additionalRentalCost: 0 },
        { equipmentId: 'eq_light_300d', name: 'Iluminador LED Aputure Light Storm 300d II', hoursUsed: 5, hourlyDepreciation: 2.43, additionalRentalCost: 0 },
      ],
      professionals: [
        { professionalId: 'pro_assistant', name: 'Assistente de Câmera / Logger', hiringType: 'daily', unitValue: 550, quantity: 1, hoursOrDays: 1, additionalExpenses: 50 },
      ],
      expenses: [
        { expenseId: 'cat_music', name: 'Licença Musical Comercial (Artlist / Musicbed)', costType: 'per_project', unitValue: 180, quantity: 1, accountingMethod: 'direct_project' },
        { expenseId: 'cat_catering', name: 'Alimentação da Equipe em Diária de Gravação', costType: 'per_unit', unitValue: 70, quantity: 2, accountingMethod: 'direct_project' },
      ],
      pricingConfig: {
        method: 'margin_on_sale',
        desiredProfitMarginPct: 25,
        desiredMarkupPct: 35,
        taxPct: 6,
        financialFeePct: 2.5,
        fixedTransactionFee: 0,
        cashDiscountPct: 10,
        installmentCount: 4,
      },
    },
    {
      id: 'tpl_corporate_video',
      name: 'Vídeo Institucional Corporativo Premium',
      description: 'Filme institucional cinematográfico de 2 a 3 minutos com depoimentos, B-Rolls e motion graphics.',
      stages: [
        { id: 's1', name: 'Briefing, Roteiro e Cronograma de Filmagem', hours: 6, hourlyRate: 150, commercialGroup: 'pre', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's2', name: 'Diária 1: Entrevistas com Executivos e Equipe', hours: 8, hourlyRate: 150, commercialGroup: 'prod', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's3', name: 'Diária 2: B-Rolls Dinâmicos e Operações da Empresa', hours: 8, hourlyRate: 150, commercialGroup: 'prod', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's4', name: 'Montagem e Edição da Linha do Tempo', hours: 16, hourlyRate: 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's5', name: 'Design de Som e Mixagem Profissional', hours: 6, hourlyRate: 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's6', name: 'Rodadas de Revisão e Entrega Master', hours: 4, hourlyRate: 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
      ],
      equipment: [
        { equipmentId: 'eq_camera_fx3', name: 'Cinema Camera Sony FX3 (Full Frame)', hoursUsed: 16, hourlyDepreciation: 8.8, additionalRentalCost: 0 },
        { equipmentId: 'eq_lens_2470', name: 'Lente Sony GM 24-70mm f/2.8 II', hoursUsed: 16, hourlyDepreciation: 2.75, additionalRentalCost: 0 },
        { equipmentId: 'eq_light_300d', name: 'Iluminador LED Aputure Light Storm 300d II', hoursUsed: 14, hourlyDepreciation: 2.43, additionalRentalCost: 0 },
        { equipmentId: 'eq_audio_rode_pro', name: 'Kit Microfone Sem Fio Rode Wireless PRO', hoursUsed: 16, hourlyDepreciation: 1.45, additionalRentalCost: 0 },
        { equipmentId: 'eq_gimbal_rs3', name: 'Estabilizador Gimbal DJI RS3 Pro Combo', hoursUsed: 8, hourlyDepreciation: 3.1, additionalRentalCost: 0 },
        { equipmentId: 'eq_tripod_manfrotto', name: 'Tripé com Cabeça Hidráulica Manfrotto 504X', hoursUsed: 12, hourlyDepreciation: 1.0, additionalRentalCost: 0 },
      ],
      professionals: [
        { professionalId: 'pro_audio', name: 'Técnico de Som Direto', hiringType: 'daily', unitValue: 750, quantity: 1, hoursOrDays: 2, additionalExpenses: 120 },
        { professionalId: 'pro_motion', name: 'Motion Designer (Vinhetas & Cartelas)', hiringType: 'fixed', unitValue: 800, quantity: 1, hoursOrDays: 1, additionalExpenses: 0 },
        { professionalId: 'pro_colorist', name: 'Colorista Profissional (DaVinci Resolve)', hiringType: 'fixed', unitValue: 1200, quantity: 1, hoursOrDays: 1, additionalExpenses: 0 },
      ],
      expenses: [
        { expenseId: 'cat_music', name: 'Licença Musical Comercial (Artlist / Musicbed)', costType: 'per_project', unitValue: 180, quantity: 1, accountingMethod: 'direct_project' },
        { expenseId: 'cat_hard_drive', name: 'SSD Portátil SanDisk Extreme 1TB para Entrega Raw', costType: 'per_project', unitValue: 650, quantity: 1, accountingMethod: 'direct_project' },
        { expenseId: 'cat_van_transport', name: 'Transporte e Combustível (Deslocamento Local)', costType: 'per_project', unitValue: 250, quantity: 2, accountingMethod: 'direct_project' },
      ],
      pricingConfig: {
        method: 'margin_on_sale',
        desiredProfitMarginPct: 30,
        desiredMarkupPct: 45,
        taxPct: 6,
        financialFeePct: 2.5,
        fixedTransactionFee: 0,
        cashDiscountPct: 10,
        installmentCount: 4,
      },
    },
  ];

  const insertTpl = db.prepare(`
    INSERT OR IGNORE INTO production_templates (
      id, name, description, stages_json, equipment_json, professionals_json,
      expenses_json, pricing_config_json, is_deleted, is_sample, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `);

  for (const tpl of initialTemplates) {
    insertTpl.run(
      tpl.id,
      tpl.name,
      tpl.description,
      JSON.stringify(tpl.stages),
      JSON.stringify(tpl.equipment),
      JSON.stringify(tpl.professionals),
      JSON.stringify(tpl.expenses),
      JSON.stringify(tpl.pricingConfig),
      now,
      now
    );
  }
}
