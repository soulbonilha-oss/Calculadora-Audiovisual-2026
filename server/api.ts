import express, { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, DB_PATH, clearSampleData, restoreSampleData } from './db.js';
import {
  calculateEquipmentDepreciation,
  calculateOwnLabor,
  calculateOverheadAllocation,
  calculateThirdPartyCost,
  calculateProjectPricing,
  validateCashDiscount,
  parseAndValidateQuantity,
} from '../src/financial/engine.js';

export const apiRouter = express.Router();

// Middleware: JSON parsing
apiRouter.use(express.json({ limit: '20mb' }));

// ==========================================
// 1. CONFIGURAÇÕES GERAIS
// ==========================================
apiRouter.get('/settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    res.json(row);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const body = req.body;
    const now = new Date().toISOString();

    const cashDiscountRes = validateCashDiscount(body.default_cash_discount_pct);
    const validCashDiscount = cashDiscountRes.isValid ? cashDiscountRes.value : 10.0;
    const validInstallments = Math.max(1, Math.min(60, Math.floor(Number(body.default_installments) || 4)));

    db.prepare(`
      UPDATE settings SET
        studio_name = ?,
        logo_url = ?,
        primary_color = ?,
        email = ?,
        phone = ?,
        website = ?,
        address = ?,
        cnpj = ?,
        default_hourly_rate = ?,
        default_billable_hours_month = ?,
        default_pricing_method = ?,
        default_profit_margin_pct = ?,
        default_markup_pct = ?,
        default_tax_pct = ?,
        default_financial_fee_pct = ?,
        default_fixed_fee = ?,
        default_cash_discount_pct = ?,
        default_installments = ?,
        proposal_valid_days = ?,
        default_notes = ?,
        terms_and_conditions = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      body.studio_name ?? 'FBonilha.mov',
      body.logo_url ?? '',
      body.primary_color ?? '#4F5D47',
      body.email ?? '',
      body.phone ?? '',
      body.website ?? '',
      body.address ?? '',
      body.cnpj ?? '',
      Number(body.default_hourly_rate) || 150.0,
      Number(body.default_billable_hours_month) || 100.0,
      body.default_pricing_method ?? 'margin_on_sale',
      Number(body.default_profit_margin_pct) || 25.0,
      Number(body.default_markup_pct) || 35.0,
      Number(body.default_tax_pct) || 6.0,
      Number(body.default_financial_fee_pct) || 2.5,
      Number(body.default_fixed_fee) || 0.0,
      validCashDiscount,
      validInstallments,
      Math.max(1, Number(body.proposal_valid_days) || 7),
      body.default_notes ?? '',
      body.terms_and_conditions ?? '',
      now
    );

    const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. EQUIPAMENTOS
// ==========================================
apiRouter.get('/equipment', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM equipment WHERE is_deleted = 0 ORDER BY category ASC, name ASC').all();
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/equipment', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const b = req.body;
    const id = b.id || `eq_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO equipment (
        id, name, category, brand, model, serial_number, acquisition_date,
        purchase_value, residual_value, useful_life_years, estimation_method,
        total_useful_hours, annual_hours, notes, is_active, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      b.name,
      b.category,
      b.brand ?? '',
      b.model ?? '',
      b.serial_number ?? '',
      b.acquisition_date ?? '',
      Number(b.purchase_value) || 0,
      Number(b.residual_value) || 0,
      Number(b.useful_life_years) || 3,
      b.estimation_method ?? 'total_hours',
      Number(b.total_useful_hours) || 2500,
      Number(b.annual_hours) || 600,
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/equipment/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const b = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE equipment SET
        name = ?,
        category = ?,
        brand = ?,
        model = ?,
        serial_number = ?,
        acquisition_date = ?,
        purchase_value = ?,
        residual_value = ?,
        useful_life_years = ?,
        estimation_method = ?,
        total_useful_hours = ?,
        annual_hours = ?,
        notes = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      b.name,
      b.category,
      b.brand ?? '',
      b.model ?? '',
      b.serial_number ?? '',
      b.acquisition_date ?? '',
      Number(b.purchase_value) || 0,
      Number(b.residual_value) || 0,
      Number(b.useful_life_years) || 3,
      b.estimation_method ?? 'total_hours',
      Number(b.total_useful_hours) || 2500,
      Number(b.annual_hours) || 600,
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/equipment/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const now = new Date().toISOString();
    // Exclusão lógica para preservar histórico de orçamentos
    db.prepare('UPDATE equipment SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    res.json({ success: true, message: 'Equipamento arquivado com sucesso.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. CUSTOS FIXOS MENSAIS (RECURRING)
// ==========================================
apiRouter.get('/recurring-expenses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM recurring_expenses WHERE is_deleted = 0 ORDER BY name ASC').all();
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/recurring-expenses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const b = req.body;
    const id = b.id || `rec_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO recurring_expenses (
        id, name, category, monthly_value, start_date, end_date, accounting_method,
        notes, is_active, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      b.name,
      b.category,
      Number(b.monthly_value) || 0,
      b.start_date ?? '',
      b.end_date ?? '',
      b.accounting_method ?? 'overhead_allocated',
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(id);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/recurring-expenses/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const b = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE recurring_expenses SET
        name = ?,
        category = ?,
        monthly_value = ?,
        start_date = ?,
        end_date = ?,
        accounting_method = ?,
        notes = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      b.name,
      b.category,
      Number(b.monthly_value) || 0,
      b.start_date ?? '',
      b.end_date ?? '',
      b.accounting_method ?? 'overhead_allocated',
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(id);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/recurring-expenses/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const now = new Date().toISOString();
    db.prepare('UPDATE recurring_expenses SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. CATÁLOGO DE DESPESAS EXTRAS & SERVIÇOS
// ==========================================
apiRouter.get('/expense-catalog', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM expense_catalog WHERE is_deleted = 0 ORDER BY category ASC, name ASC').all();
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/expense-catalog', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const b = req.body;
    const id = b.id || `cat_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO expense_catalog (
        id, name, category, description, cost_type, default_value, periodicity,
        accounting_method, notes, is_active, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      b.name,
      b.category,
      b.description ?? '',
      b.cost_type ?? 'per_project',
      Number(b.default_value) || 0,
      b.periodicity ?? 'project',
      b.accounting_method ?? 'direct_project',
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM expense_catalog WHERE id = ?').get(id);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/expense-catalog/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const b = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE expense_catalog SET
        name = ?,
        category = ?,
        description = ?,
        cost_type = ?,
        default_value = ?,
        periodicity = ?,
        accounting_method = ?,
        notes = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      b.name,
      b.category,
      b.description ?? '',
      b.cost_type ?? 'per_project',
      Number(b.default_value) || 0,
      b.periodicity ?? 'project',
      b.accounting_method ?? 'direct_project',
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM expense_catalog WHERE id = ?').get(id);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/expense-catalog/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const now = new Date().toISOString();
    db.prepare('UPDATE expense_catalog SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. PROFISSIONAIS E TERCEIRIZADOS
// ==========================================
apiRouter.get('/professionals', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM professionals WHERE is_deleted = 0 ORDER BY specialty ASC, name ASC').all();
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/professionals', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const b = req.body;
    const id = b.id || `pro_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO professionals (
        id, name, specialty, phone, email, hiring_type, default_value,
        notes, is_active, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      b.name,
      b.specialty,
      b.phone ?? '',
      b.email ?? '',
      b.hiring_type ?? 'daily',
      Number(b.default_value) || 0,
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM professionals WHERE id = ?').get(id);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/professionals/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const b = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE professionals SET
        name = ?,
        specialty = ?,
        phone = ?,
        email = ?,
        hiring_type = ?,
        default_value = ?,
        notes = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      b.name,
      b.specialty,
      b.phone ?? '',
      b.email ?? '',
      b.hiring_type ?? 'daily',
      Number(b.default_value) || 0,
      b.notes ?? '',
      b.is_active === false ? 0 : 1,
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM professionals WHERE id = ?').get(id);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/professionals/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const now = new Date().toISOString();
    db.prepare('UPDATE professionals SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 6. MODELOS DE PRODUÇÃO (TEMPLATES)
// ==========================================
apiRouter.get('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM production_templates WHERE is_deleted = 0 ORDER BY name ASC').all();
    const parsed = rows.map((r: any) => ({
      ...r,
      stages: JSON.parse(r.stages_json || '[]'),
      equipment: JSON.parse(r.equipment_json || '[]'),
      professionals: JSON.parse(r.professionals_json || '[]'),
      expenses: JSON.parse(r.expenses_json || '[]'),
      pricingConfig: JSON.parse(r.pricing_config_json || '{}'),
    }));
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const b = req.body;
    const id = b.id || `tpl_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO production_templates (
        id, name, description, stages_json, equipment_json, professionals_json,
        expenses_json, pricing_config_json, notes, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      b.name,
      b.description ?? '',
      JSON.stringify(b.stages || []),
      JSON.stringify(b.equipment || []),
      JSON.stringify(b.professionals || []),
      JSON.stringify(b.expenses || []),
      JSON.stringify(b.pricingConfig || {}),
      b.notes ?? '',
      now,
      now
    );

    const created = db.prepare('SELECT * FROM production_templates WHERE id = ?').get(id) as any;
    res.status(201).json({
      ...created,
      stages: JSON.parse(created.stages_json || '[]'),
      equipment: JSON.parse(created.equipment_json || '[]'),
      professionals: JSON.parse(created.professionals_json || '[]'),
      expenses: JSON.parse(created.expenses_json || '[]'),
      pricingConfig: JSON.parse(created.pricing_config_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const b = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE production_templates SET
        name = ?,
        description = ?,
        stages_json = ?,
        equipment_json = ?,
        professionals_json = ?,
        expenses_json = ?,
        pricing_config_json = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      b.name,
      b.description ?? '',
      JSON.stringify(b.stages || []),
      JSON.stringify(b.equipment || []),
      JSON.stringify(b.professionals || []),
      JSON.stringify(b.expenses || []),
      JSON.stringify(b.pricingConfig || {}),
      b.notes ?? '',
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM production_templates WHERE id = ?').get(id) as any;
    res.json({
      ...updated,
      stages: JSON.parse(updated.stages_json || '[]'),
      equipment: JSON.parse(updated.equipment_json || '[]'),
      professionals: JSON.parse(updated.professionals_json || '[]'),
      expenses: JSON.parse(updated.expenses_json || '[]'),
      pricingConfig: JSON.parse(updated.pricing_config_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/templates/:id/clone', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sourceId = req.params.id;
    const source = db.prepare('SELECT * FROM production_templates WHERE id = ?').get(sourceId) as any;
    if (!source) return res.status(404).json({ error: 'Modelo não encontrado.' });

    const newId = `tpl_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const newName = `${source.name} (Cópia)`;

    db.prepare(`
      INSERT INTO production_templates (
        id, name, description, stages_json, equipment_json, professionals_json,
        expenses_json, pricing_config_json, notes, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      newId,
      newName,
      source.description,
      source.stages_json,
      source.equipment_json,
      source.professionals_json,
      source.expenses_json,
      source.pricing_config_json,
      source.notes,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM production_templates WHERE id = ?').get(newId) as any;
    res.status(201).json({
      ...created,
      stages: JSON.parse(created.stages_json || '[]'),
      equipment: JSON.parse(created.equipment_json || '[]'),
      professionals: JSON.parse(created.professionals_json || '[]'),
      expenses: JSON.parse(created.expenses_json || '[]'),
      pricingConfig: JSON.parse(created.pricing_config_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const now = new Date().toISOString();
    db.prepare('UPDATE production_templates SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 7. ORÇAMENTOS (BUDGETS) COM SNAPSHOTS IMUTÁVEIS
// ==========================================
apiRouter.get('/budgets', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM budgets WHERE is_deleted = 0 ORDER BY updated_at DESC').all();
    const parsed = rows.map((r: any) => ({
      ...r,
      stages: JSON.parse(r.stages_snapshot_json || '[]'),
      equipment: JSON.parse(r.equipment_snapshot_json || '[]'),
      professionals: JSON.parse(r.professionals_snapshot_json || '[]'),
      expenses: JSON.parse(r.expenses_snapshot_json || '[]'),
      pricingConfig: JSON.parse(r.pricing_config_json || '{}'),
      calculatedSummary: JSON.parse(r.calculated_summary_json || '{}'),
    }));
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.get('/budgets/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const r = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as any;
    if (!r) return res.status(404).json({ error: 'Orçamento não encontrado.' });

    res.json({
      ...r,
      stages: JSON.parse(r.stages_snapshot_json || '[]'),
      equipment: JSON.parse(r.equipment_snapshot_json || '[]'),
      professionals: JSON.parse(r.professionals_snapshot_json || '[]'),
      expenses: JSON.parse(r.expenses_snapshot_json || '[]'),
      pricingConfig: JSON.parse(r.pricing_config_json || '{}'),
      calculatedSummary: JSON.parse(r.calculated_summary_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/budgets', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const b = req.body;
    const id = b.id || `bud_${crypto.randomUUID()}`;
    const code = b.code || `ORC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO budgets (
        id, code, title, client_name, client_company, client_email, client_phone,
        description, scope_summary, internal_notes, responsible, status, template_id,
        stages_snapshot_json, equipment_snapshot_json, professionals_snapshot_json,
        expenses_snapshot_json, pricing_config_json, calculated_summary_json,
        is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      code,
      b.title || 'Novo Orçamento Audiovisual',
      b.client_name || 'Cliente',
      b.client_company ?? '',
      b.client_email ?? '',
      b.client_phone ?? '',
      b.description ?? '',
      b.scope_summary ?? '',
      b.internal_notes ?? '',
      b.responsible ?? 'FBonilha',
      b.status ?? 'draft',
      b.template_id ?? null,
      JSON.stringify(b.stages || []),
      JSON.stringify(b.equipment || []),
      JSON.stringify(b.professionals || []),
      JSON.stringify(b.expenses || []),
      JSON.stringify(b.pricingConfig || {}),
      JSON.stringify(b.calculatedSummary || {}),
      now,
      now
    );

    const created = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as any;
    res.status(201).json({
      ...created,
      stages: JSON.parse(created.stages_snapshot_json || '[]'),
      equipment: JSON.parse(created.equipment_snapshot_json || '[]'),
      professionals: JSON.parse(created.professionals_snapshot_json || '[]'),
      expenses: JSON.parse(created.expenses_snapshot_json || '[]'),
      pricingConfig: JSON.parse(created.pricing_config_json || '{}'),
      calculatedSummary: JSON.parse(created.calculated_summary_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put('/budgets/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const b = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE budgets SET
        title = ?,
        client_name = ?,
        client_company = ?,
        client_email = ?,
        client_phone = ?,
        description = ?,
        scope_summary = ?,
        internal_notes = ?,
        responsible = ?,
        status = ?,
        template_id = ?,
        stages_snapshot_json = ?,
        equipment_snapshot_json = ?,
        professionals_snapshot_json = ?,
        expenses_snapshot_json = ?,
        pricing_config_json = ?,
        calculated_summary_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      b.title,
      b.client_name,
      b.client_company ?? '',
      b.client_email ?? '',
      b.client_phone ?? '',
      b.description ?? '',
      b.scope_summary ?? '',
      b.internal_notes ?? '',
      b.responsible ?? 'FBonilha',
      b.status ?? 'draft',
      b.template_id ?? null,
      JSON.stringify(b.stages || []),
      JSON.stringify(b.equipment || []),
      JSON.stringify(b.professionals || []),
      JSON.stringify(b.expenses || []),
      JSON.stringify(b.pricingConfig || {}),
      JSON.stringify(b.calculatedSummary || {}),
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as any;
    res.json({
      ...updated,
      stages: JSON.parse(updated.stages_snapshot_json || '[]'),
      equipment: JSON.parse(updated.equipment_snapshot_json || '[]'),
      professionals: JSON.parse(updated.professionals_snapshot_json || '[]'),
      expenses: JSON.parse(updated.expenses_snapshot_json || '[]'),
      pricingConfig: JSON.parse(updated.pricing_config_json || '{}'),
      calculatedSummary: JSON.parse(updated.calculated_summary_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/budgets/:id/clone', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sourceId = req.params.id;
    const source = db.prepare('SELECT * FROM budgets WHERE id = ?').get(sourceId) as any;
    if (!source) return res.status(404).json({ error: 'Orçamento não encontrado.' });

    const newId = `bud_${crypto.randomUUID()}`;
    const code = `ORC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();
    const newTitle = `${source.title} (Cópia)`;

    db.prepare(`
      INSERT INTO budgets (
        id, code, title, client_name, client_company, client_email, client_phone,
        description, scope_summary, internal_notes, responsible, status, template_id,
        stages_snapshot_json, equipment_snapshot_json, professionals_snapshot_json,
        expenses_snapshot_json, pricing_config_json, calculated_summary_json,
        is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      newId,
      code,
      newTitle,
      source.client_name,
      source.client_company,
      source.client_email,
      source.client_phone,
      source.description,
      source.scope_summary,
      source.internal_notes,
      source.responsible,
      source.template_id,
      source.stages_snapshot_json,
      source.equipment_snapshot_json,
      source.professionals_snapshot_json,
      source.expenses_snapshot_json,
      source.pricing_config_json,
      source.calculated_summary_json,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM budgets WHERE id = ?').get(newId) as any;
    res.status(201).json({
      ...created,
      stages: JSON.parse(created.stages_snapshot_json || '[]'),
      equipment: JSON.parse(created.equipment_snapshot_json || '[]'),
      professionals: JSON.parse(created.professionals_snapshot_json || '[]'),
      expenses: JSON.parse(created.expenses_snapshot_json || '[]'),
      pricingConfig: JSON.parse(created.pricing_config_json || '{}'),
      calculatedSummary: JSON.parse(created.calculated_summary_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.delete('/budgets/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const now = new Date().toISOString();
    db.prepare('UPDATE budgets SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    res.json({ success: true, message: 'Orçamento arquivado.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Emissão formal de proposta comercial
apiRouter.post('/budgets/:id/emit-proposal', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const budgetId = req.params.id;
    const body = req.body;
    const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(budgetId) as any;
    if (!budget) return res.status(404).json({ error: 'Orçamento não encontrado.' });

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    const proposalId = `prop_${crypto.randomUUID()}`;
    const proposalCode = `PROP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const issueDate = now.toISOString().slice(0, 10);
    const validDays = Number(settings?.proposal_valid_days) || 7;
    const validUntilDateObj = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
    const validUntilDate = validUntilDateObj.toISOString().slice(0, 10);

    const stages = JSON.parse(budget.stages_snapshot_json || '[]');
    let preHours = 0;
    let prodHours = 0;
    let postHours = 0;

    for (const s of stages) {
      const h = Number(s.hours) || 0;
      if (s.commercialGroup === 'pre') preHours += h;
      else if (s.commercialGroup === 'prod') prodHours += h;
      else postHours += h;
    }

    const stageHoursSummary = {
      preProductionHours: Math.round(preHours * 10) / 10,
      productionHours: Math.round(prodHours * 10) / 10,
      postProductionHours: Math.round(postHours * 10) / 10,
    };

    const calculatedSummary = JSON.parse(budget.calculated_summary_json || '{}');
    const totalPrice = Math.max(0, Number(body.totalPrice ?? calculatedSummary.finalBasePrice) || 0);

    const discountRes = validateCashDiscount(body.cashDiscountPct ?? settings?.default_cash_discount_pct ?? 10);
    const cashDiscountPct = discountRes.isValid ? discountRes.value : 10;
    const cashPrice = Math.max(0, Number((totalPrice * (1 - cashDiscountPct / 100)).toFixed(2)));

    const installmentCount = Math.max(1, Math.min(60, Math.floor(Number(body.installmentCount ?? settings?.default_installments) || 4)));
    const installmentValue = Number((totalPrice / installmentCount).toFixed(2));

    const issuerContact = {
      studioName: settings?.studio_name ?? 'FBonilha.mov',
      phone: settings?.phone ?? '',
      email: settings?.email ?? '',
      website: settings?.website ?? '',
      cnpj: settings?.cnpj ?? '',
      address: settings?.address ?? '',
    };

    db.prepare(`
      INSERT INTO proposals (
        id, budget_id, proposal_code, client_name, project_title, scope_summary,
        stage_hours_summary_json, total_price, cash_price, cash_discount_pct,
        installment_count, installment_value, issue_date, valid_until_date,
        issuer_contact_json, commercial_terms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      proposalId,
      budgetId,
      proposalCode,
      budget.client_name,
      budget.title,
      budget.scope_summary || budget.description,
      JSON.stringify(stageHoursSummary),
      totalPrice,
      cashPrice,
      cashDiscountPct,
      installmentCount,
      installmentValue,
      issueDate,
      validUntilDate,
      JSON.stringify(issuerContact),
      settings?.terms_and_conditions || ''
    );

    // Atualiza status do orçamento para 'proposal_sent'
    db.prepare("UPDATE budgets SET status = 'proposal_sent', updated_at = datetime('now') WHERE id = ?").run(budgetId);

    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as any;
    res.status(201).json({
      ...proposal,
      stageHoursSummary: JSON.parse(proposal.stage_hours_summary_json || '{}'),
      issuerContact: JSON.parse(proposal.issuer_contact_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Consultas de Propostas Comerciais Emitidas (Histórico Imutável)
apiRouter.get('/proposals', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all();
    const parsed = rows.map((r: any) => ({
      ...r,
      stageHoursSummary: JSON.parse(r.stage_hours_summary_json || '{}'),
      issuerContact: JSON.parse(r.issuer_contact_json || '{}'),
    }));
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.get('/budgets/:id/proposals', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const budgetId = req.params.id;
    const rows = db.prepare('SELECT * FROM proposals WHERE budget_id = ? ORDER BY created_at DESC').all(budgetId);
    const parsed = rows.map((r: any) => ({
      ...r,
      stageHoursSummary: JSON.parse(r.stage_hours_summary_json || '{}'),
      issuerContact: JSON.parse(r.issuer_contact_json || '{}'),
    }));
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.get('/proposals/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const r = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as any;
    if (!r) return res.status(404).json({ error: 'Proposta não encontrada.' });
    res.json({
      ...r,
      stageHoursSummary: JSON.parse(r.stage_hours_summary_json || '{}'),
      issuerContact: JSON.parse(r.issuer_contact_json || '{}'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Gerenciamento de Dados de Demonstração (Permite base vazia sem contaminar dados do usuário)
apiRouter.post('/demo/clear-samples', (req: Request, res: Response) => {
  try {
    const db = getDb();
    clearSampleData(db);
    res.json({ success: true, message: 'Dados demonstrativos removidos. A base contém agora exclusivamente cadastros criados por você.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/demo/restore-samples', (req: Request, res: Response) => {
  try {
    const db = getDb();
    restoreSampleData(db);
    res.json({ success: true, message: 'Dados de demonstração restaurados com sucesso.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 8. BACKUP, EXPORTAÇÃO E RESTAURAÇÃO
// ==========================================

export interface BackupValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    equipmentCount: number;
    recurringExpensesCount: number;
    catalogCount: number;
    professionalsCount: number;
    templatesCount: number;
    budgetsCount: number;
    proposalsCount: number;
  };
}

export function validateBackupPayload(payload: any, currentDb?: any): BackupValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary = {
    equipmentCount: 0,
    recurringExpensesCount: 0,
    catalogCount: 0,
    professionalsCount: 0,
    templatesCount: 0,
    budgetsCount: 0,
    proposalsCount: 0,
  };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      isValid: false,
      errors: ['O arquivo de backup deve ser um objeto JSON válido.'],
      warnings: [],
      summary,
    };
  }

  // Verificar versão do esquema
  const schemaVersion = payload.schema_version ?? (payload.version ? 1 : null);
  if (schemaVersion === null) {
    warnings.push('Versão de esquema ausente no arquivo; assumindo formato compatível v1.');
  }

  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    return {
      isValid: false,
      errors: ['O arquivo de backup não contém a propriedade "data" estruturada.'],
      warnings,
      summary,
    };
  }

  const data = payload.data;

  // Validação de Equipamentos
  if (data.equipment !== undefined) {
    if (!Array.isArray(data.equipment)) {
      errors.push('A entidade "equipment" deve ser uma lista (array).');
    } else {
      summary.equipmentCount = data.equipment.length;
      const seenIds = new Set<string>();
      data.equipment.forEach((item: any, idx: number) => {
        if (!item || typeof item !== 'object') {
          errors.push(`Equipamento na posição ${idx} não é um objeto válido.`);
          return;
        }
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Equipamento na posição ${idx} possui identificador (id) inválido.`);
        } else if (seenIds.has(item.id)) {
          errors.push(`ID duplicado em equipamentos: "${item.id}".`);
        } else {
          seenIds.add(item.id);
        }
        if (!item.name || typeof item.name !== 'string') {
          errors.push(`Equipamento "${item.id || idx}" possui nome obrigatório ausente.`);
        }
        if (item.purchase_value !== undefined && (isNaN(Number(item.purchase_value)) || Number(item.purchase_value) < 0)) {
          errors.push(`Equipamento "${item.name || idx}" possui valor de compra numérico inválido.`);
        }
      });
    }
  }

  // Validação de Custos Fixos
  if (data.recurring_expenses !== undefined) {
    if (!Array.isArray(data.recurring_expenses)) {
      errors.push('A entidade "recurring_expenses" deve ser uma lista.');
    } else {
      summary.recurringExpensesCount = data.recurring_expenses.length;
      const seenIds = new Set<string>();
      data.recurring_expenses.forEach((item: any, idx: number) => {
        if (!item || typeof item !== 'object') {
          errors.push(`Custo fixo na posição ${idx} não é um objeto válido.`);
          return;
        }
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Custo fixo na posição ${idx} possui ID inválido.`);
        } else if (seenIds.has(item.id)) {
          errors.push(`ID duplicado em custos fixos: "${item.id}".`);
        } else {
          seenIds.add(item.id);
        }
        if (!item.name) errors.push(`Custo fixo "${item.id || idx}" possui nome ausente.`);
      });
    }
  }

  // Validação de Catálogo
  if (data.expense_catalog !== undefined) {
    if (!Array.isArray(data.expense_catalog)) {
      errors.push('A entidade "expense_catalog" deve ser uma lista.');
    } else {
      summary.catalogCount = data.expense_catalog.length;
      const seenIds = new Set<string>();
      data.expense_catalog.forEach((item: any, idx: number) => {
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Item de catálogo na posição ${idx} possui ID inválido.`);
        } else if (seenIds.has(item.id)) {
          errors.push(`ID duplicado em catálogo de despesas: "${item.id}".`);
        } else {
          seenIds.add(item.id);
        }
      });
    }
  }

  // Validação de Profissionais
  if (data.professionals !== undefined) {
    if (!Array.isArray(data.professionals)) {
      errors.push('A entidade "professionals" deve ser uma lista.');
    } else {
      summary.professionalsCount = data.professionals.length;
      const seenIds = new Set<string>();
      data.professionals.forEach((item: any, idx: number) => {
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Profissional na posição ${idx} possui ID inválido.`);
        } else if (seenIds.has(item.id)) {
          errors.push(`ID duplicado em profissionais: "${item.id}".`);
        } else {
          seenIds.add(item.id);
        }
      });
    }
  }

  // Validação de Modelos
  if (data.production_templates !== undefined) {
    if (!Array.isArray(data.production_templates)) {
      errors.push('A entidade "production_templates" deve ser uma lista.');
    } else {
      summary.templatesCount = data.production_templates.length;
      const seenIds = new Set<string>();
      data.production_templates.forEach((item: any, idx: number) => {
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Modelo na posição ${idx} possui ID inválido.`);
        } else if (seenIds.has(item.id)) {
          errors.push(`ID duplicado em modelos: "${item.id}".`);
        } else {
          seenIds.add(item.id);
        }
      });
    }
  }

  // Validação de Orçamentos
  const budgetIdsInBackup = new Set<string>();
  if (data.budgets !== undefined) {
    if (!Array.isArray(data.budgets)) {
      errors.push('A entidade "budgets" deve ser uma lista.');
    } else {
      summary.budgetsCount = data.budgets.length;
      data.budgets.forEach((item: any, idx: number) => {
        if (!item || typeof item !== 'object') {
          errors.push(`Orçamento na posição ${idx} não é um objeto válido.`);
          return;
        }
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Orçamento na posição ${idx} possui ID inválido.`);
        } else if (budgetIdsInBackup.has(item.id)) {
          errors.push(`ID duplicado em orçamentos: "${item.id}".`);
        } else {
          budgetIdsInBackup.add(item.id);
        }
        if (!item.title) errors.push(`Orçamento "${item.id || idx}" possui título ausente.`);
        if (!item.client_name) errors.push(`Orçamento "${item.id || idx}" possui nome do cliente ausente.`);
      });
    }
  }

  // Validação de Propostas e Integridade Referencial
  if (data.proposals !== undefined) {
    if (!Array.isArray(data.proposals)) {
      errors.push('A entidade "proposals" deve ser uma lista.');
    } else {
      summary.proposalsCount = data.proposals.length;
      const seenProposalIds = new Set<string>();
      data.proposals.forEach((item: any, idx: number) => {
        if (!item || typeof item !== 'object') {
          errors.push(`Proposta na posição ${idx} não é um objeto válido.`);
          return;
        }
        if (!item.id || typeof item.id !== 'string') {
          errors.push(`Proposta na posição ${idx} possui ID inválido.`);
        } else if (seenProposalIds.has(item.id)) {
          errors.push(`ID duplicado em propostas: "${item.id}".`);
        } else {
          seenProposalIds.add(item.id);
        }

        // Checar integridade referencial: proposta deve apontar para orçamento
        if (!item.budget_id || typeof item.budget_id !== 'string') {
          errors.push(`Proposta "${item.id || idx}" não possui referência de orçamento (budget_id).`);
        } else if (!budgetIdsInBackup.has(item.budget_id)) {
          if (currentDb) {
            const exists = currentDb.prepare('SELECT id FROM budgets WHERE id = ?').get(item.budget_id);
            if (!exists) {
              errors.push(`Proposta "${item.id}" faz referência a orçamento inexistente ("${item.budget_id}").`);
            }
          } else {
            warnings.push(`Proposta "${item.id}" faz referência a orçamento "${item.budget_id}" ausente no backup.`);
          }
        }

        if (item.total_price !== undefined && (isNaN(Number(item.total_price)) || Number(item.total_price) < 0)) {
          errors.push(`Proposta "${item.id || idx}" possui valor total monetário negativo ou inválido.`);
        }
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

apiRouter.get('/backup/export-json', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const equipment = db.prepare('SELECT * FROM equipment').all();
    const recurring = db.prepare('SELECT * FROM recurring_expenses').all();
    const catalog = db.prepare('SELECT * FROM expense_catalog').all();
    const professionals = db.prepare('SELECT * FROM professionals').all();
    const templates = db.prepare('SELECT * FROM production_templates').all();
    const budgets = db.prepare('SELECT * FROM budgets').all();
    const proposals = db.prepare('SELECT * FROM proposals').all();

    const backupData = {
      app: 'FBonilha.mov',
      version: '2.0.0',
      schema_version: 3,
      exported_at: new Date().toISOString(),
      data: {
        settings,
        equipment,
        recurring_expenses: recurring,
        expense_catalog: catalog,
        professionals,
        production_templates: templates,
        budgets,
        proposals,
      },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=backup_fbonilha_${new Date().toISOString().slice(0, 10)}.json`);
    res.json(backupData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Exportação SQLite Atômica e Confiável em WAL Mode via VACUUM INTO
apiRouter.get('/backup/export-sqlite', (req: Request, res: Response) => {
  let tempBackupPath = '';
  try {
    const db = getDb();
    tempBackupPath = path.resolve('/tmp', `fbonilha_backup_${crypto.randomUUID()}.sqlite`);

    // SQLite nativo VACUUM INTO cria um snapshot consistente e completo independente de WAL
    db.exec(`VACUUM INTO '${tempBackupPath.replace(/'/g, "''")}';`);

    // Validação de integridade do arquivo gerado
    const checkDb = new DatabaseSync(tempBackupPath);
    const checkResult = checkDb.prepare('PRAGMA integrity_check').get() as any;
    checkDb.close();

    if (checkResult?.integrity_check !== 'ok') {
      try { fs.unlinkSync(tempBackupPath); } catch {}
      return res.status(500).json({ error: 'Falha na verificação de integridade do banco SQLite gerado.' });
    }

    res.download(tempBackupPath, `fbonilha_${new Date().toISOString().slice(0, 10)}.sqlite`, (err) => {
      if (tempBackupPath && fs.existsSync(tempBackupPath)) {
        try { fs.unlinkSync(tempBackupPath); } catch {}
      }
    });
  } catch (error: any) {
    if (tempBackupPath && fs.existsSync(tempBackupPath)) {
      try { fs.unlinkSync(tempBackupPath); } catch {}
    }
    res.status(500).json({ error: `Erro ao exportar banco SQLite consistente: ${error.message}` });
  }
});

apiRouter.post('/backup/import-json', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const payload = req.body;
    const mode = req.query.mode || 'preview'; // 'preview' ou 'commit'

    const validation = validateBackupPayload(payload, db);

    if (mode === 'preview') {
      return res.json({
        valid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
        summary: validation.summary,
        exportedAt: payload?.exported_at,
        app: payload?.app,
        version: payload?.version,
      });
    }

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Arquivo de backup rejeitado por falha de integridade estrutural.',
        details: validation.errors,
      });
    }

    const data = payload.data;
    const summary = validation.summary;

    // Criar snapshot prévio de segurança em disco antes de alterar o banco
    try {
      const backupDir = path.resolve(process.cwd(), 'data');
      const safetyBackupPath = path.resolve(backupDir, `safety_pre_restore_${Date.now()}.sqlite`);
      db.exec(`VACUUM INTO '${safetyBackupPath.replace(/'/g, "''")}';`);
    } catch (vacuumErr) {
      console.warn('Aviso: falha ao gerar backup prévio com VACUUM INTO:', vacuumErr);
    }

    // Modo commit: Restaurar integralmente dentro de transação SQLite com rollback
    db.exec('BEGIN TRANSACTION;');

    try {
      if (data.settings) {
        const s = data.settings;
        db.prepare(`
          UPDATE settings SET
            studio_name = ?, logo_url = ?, primary_color = ?, email = ?, phone = ?,
            website = ?, address = ?, cnpj = ?, default_hourly_rate = ?,
            default_billable_hours_month = ?, default_pricing_method = ?,
            default_profit_margin_pct = ?, default_markup_pct = ?, default_tax_pct = ?,
            default_financial_fee_pct = ?, default_fixed_fee = ?, default_cash_discount_pct = ?,
            default_installments = ?, proposal_valid_days = ?, default_notes = ?,
            terms_and_conditions = ?, updated_at = datetime('now')
          WHERE id = 1
        `).run(
          s.studio_name ?? 'FBonilha.mov',
          s.logo_url ?? '',
          s.primary_color ?? '#4F5D47',
          s.email ?? '',
          s.phone ?? '',
          s.website ?? '',
          s.address ?? '',
          s.cnpj ?? '',
          Number(s.default_hourly_rate) || 150.0,
          Number(s.default_billable_hours_month) || 100.0,
          s.default_pricing_method ?? 'margin_on_sale',
          Number(s.default_profit_margin_pct) || 25.0,
          Number(s.default_markup_pct) || 35.0,
          Number(s.default_tax_pct) || 6.0,
          Number(s.default_financial_fee_pct) || 2.5,
          Number(s.default_fixed_fee) || 0.0,
          s.default_cash_discount_pct !== undefined ? Number(s.default_cash_discount_pct) : 10.0,
          Number(s.default_installments) || 4,
          Number(s.proposal_valid_days) || 7,
          s.default_notes ?? '',
          s.terms_and_conditions ?? ''
        );
      }

      // Restauração de Equipamentos
      if (Array.isArray(data.equipment)) {
        const insertEq = db.prepare(`
          INSERT OR REPLACE INTO equipment (
            id, name, category, brand, model, serial_number, acquisition_date,
            purchase_value, residual_value, useful_life_years, estimation_method,
            total_useful_hours, annual_hours, notes, is_active, is_deleted, is_sample, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const e of data.equipment) {
          insertEq.run(
            e.id, e.name, e.category, e.brand ?? '', e.model ?? '', e.serial_number ?? '',
            e.acquisition_date ?? '', Number(e.purchase_value) || 0, Number(e.residual_value) || 0,
            Number(e.useful_life_years) || 3, e.estimation_method ?? 'total_hours',
            Number(e.total_useful_hours) || 2500, Number(e.annual_hours) || 600, e.notes ?? '',
            e.is_active ?? 1, e.is_deleted ?? 0, e.is_sample ?? 0,
            e.created_at || new Date().toISOString(), e.updated_at || new Date().toISOString()
          );
        }
      }

      // Restauração de Custos Fixos
      if (Array.isArray(data.recurring_expenses)) {
        const insertRec = db.prepare(`
          INSERT OR REPLACE INTO recurring_expenses (
            id, name, category, monthly_value, start_date, end_date, accounting_method,
            notes, is_active, is_deleted, is_sample, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of data.recurring_expenses) {
          insertRec.run(
            r.id, r.name, r.category, Number(r.monthly_value) || 0, r.start_date ?? '', r.end_date ?? '',
            r.accounting_method ?? 'overhead_allocated', r.notes ?? '', r.is_active ?? 1,
            r.is_deleted ?? 0, r.is_sample ?? 0, r.created_at || new Date().toISOString(), r.updated_at || new Date().toISOString()
          );
        }
      }

      // Restauração de Catálogo
      if (Array.isArray(data.expense_catalog)) {
        const insertCat = db.prepare(`
          INSERT OR REPLACE INTO expense_catalog (
            id, name, category, description, cost_type, default_value, periodicity,
            accounting_method, notes, is_active, is_deleted, is_sample, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of data.expense_catalog) {
          insertCat.run(
            c.id, c.name, c.category, c.description ?? '', c.cost_type ?? 'per_project',
            Number(c.default_value) || 0, c.periodicity ?? '', c.accounting_method ?? 'direct_project',
            c.notes ?? '', c.is_active ?? 1, c.is_deleted ?? 0, c.is_sample ?? 0,
            c.created_at || new Date().toISOString(), c.updated_at || new Date().toISOString()
          );
        }
      }

      // Restauração de Profissionais
      if (Array.isArray(data.professionals)) {
        const insertPro = db.prepare(`
          INSERT OR REPLACE INTO professionals (
            id, name, specialty, phone, email, hiring_type, default_value,
            notes, is_active, is_deleted, is_sample, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of data.professionals) {
          insertPro.run(
            p.id, p.name, p.specialty, p.phone ?? '', p.email ?? '', p.hiring_type ?? 'daily',
            Number(p.default_value) || 0, p.notes ?? '', p.is_active ?? 1,
            p.is_deleted ?? 0, p.is_sample ?? 0, p.created_at || new Date().toISOString(), p.updated_at || new Date().toISOString()
          );
        }
      }

      // Restauração de Modelos
      if (Array.isArray(data.production_templates)) {
        const insertTpl = db.prepare(`
          INSERT OR REPLACE INTO production_templates (
            id, name, description, stages_json, equipment_json, professionals_json,
            expenses_json, pricing_config_json, notes, is_deleted, is_sample, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of data.production_templates) {
          insertTpl.run(
            t.id, t.name, t.description ?? '',
            typeof t.stages_json === 'string' ? t.stages_json : JSON.stringify(t.stages || []),
            typeof t.equipment_json === 'string' ? t.equipment_json : JSON.stringify(t.equipment || []),
            typeof t.professionals_json === 'string' ? t.professionals_json : JSON.stringify(t.professionals || []),
            typeof t.expenses_json === 'string' ? t.expenses_json : JSON.stringify(t.expenses || []),
            typeof t.pricing_config_json === 'string' ? t.pricing_config_json : JSON.stringify(t.pricingConfig || {}),
            t.notes ?? '', t.is_deleted ?? 0, t.is_sample ?? 0,
            t.created_at || new Date().toISOString(), t.updated_at || new Date().toISOString()
          );
        }
      }

      // Restauração de Orçamentos
      if (Array.isArray(data.budgets)) {
        const insertBud = db.prepare(`
          INSERT OR REPLACE INTO budgets (
            id, code, title, client_name, client_company, client_email, client_phone,
            description, scope_summary, internal_notes, responsible, status, template_id,
            stages_snapshot_json, equipment_snapshot_json, professionals_snapshot_json,
            expenses_snapshot_json, pricing_config_json, calculated_summary_json,
            is_deleted, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const b of data.budgets) {
          insertBud.run(
            b.id, b.code, b.title, b.client_name, b.client_company ?? '', b.client_email ?? '',
            b.client_phone ?? '', b.description ?? '', b.scope_summary ?? '', b.internal_notes ?? '',
            b.responsible ?? 'FBonilha', b.status ?? 'draft', b.template_id ?? null,
            typeof b.stages_snapshot_json === 'string' ? b.stages_snapshot_json : JSON.stringify(b.stages || []),
            typeof b.equipment_snapshot_json === 'string' ? b.equipment_snapshot_json : JSON.stringify(b.equipment || []),
            typeof b.professionals_snapshot_json === 'string' ? b.professionals_snapshot_json : JSON.stringify(b.professionals || []),
            typeof b.expenses_snapshot_json === 'string' ? b.expenses_snapshot_json : JSON.stringify(b.expenses || []),
            typeof b.pricing_config_json === 'string' ? b.pricing_config_json : JSON.stringify(b.pricingConfig || {}),
            typeof b.calculated_summary_json === 'string' ? b.calculated_summary_json : JSON.stringify(b.calculatedSummary || {}),
            b.is_deleted ?? 0, b.created_at || new Date().toISOString(), b.updated_at || new Date().toISOString()
          );
        }
      }

      // Restauração Integral de Propostas Comerciais (Snapshots Imutáveis de Emissão)
      if (Array.isArray(data.proposals)) {
        const insertProp = db.prepare(`
          INSERT OR REPLACE INTO proposals (
            id, budget_id, proposal_code, client_name, project_title, scope_summary,
            stage_hours_summary_json, total_price, cash_price, cash_discount_pct,
            installment_count, installment_value, issue_date, valid_until_date,
            issuer_contact_json, commercial_terms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of data.proposals) {
          insertProp.run(
            p.id,
            p.budget_id,
            p.proposal_code,
            p.client_name,
            p.project_title,
            p.scope_summary ?? '',
            typeof p.stage_hours_summary_json === 'string' ? p.stage_hours_summary_json : JSON.stringify(p.stageHoursSummary || {}),
            Number(p.total_price) || 0,
            Number(p.cash_price) || 0,
            Number(p.cash_discount_pct) || 10.0,
            Number(p.installment_count) || 4,
            Number(p.installment_value) || 0,
            p.issue_date || new Date().toISOString().slice(0, 10),
            p.valid_until_date || new Date().toISOString().slice(0, 10),
            typeof p.issuer_contact_json === 'string' ? p.issuer_contact_json : JSON.stringify(p.issuerContact || {}),
            p.commercial_terms ?? '',
            p.created_at || new Date().toISOString()
          );
        }
      }

      db.exec('COMMIT;');
      res.json({ success: true, message: 'Dados e propostas restaurados com sucesso dentro de transação atômica.', summary });
    } catch (innerError: any) {
      db.exec('ROLLBACK;');
      throw innerError;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
