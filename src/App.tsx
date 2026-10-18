import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, ActiveView } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardView } from './components/dashboard/DashboardView';
import { EquipmentView } from './components/equipment/EquipmentView';
import { FixedExpensesView } from './components/expenses/FixedExpensesView';
import { ExpenseCatalogView } from './components/expenses/ExpenseCatalogView';
import { ProfessionalsView } from './components/professionals/ProfessionalsView';
import { TemplatesView } from './components/templates/TemplatesView';
import { BudgetEditorView } from './components/budgets/BudgetEditorView';
import { BudgetListView } from './components/budgets/BudgetListView';
import { SettingsView } from './components/settings/SettingsView';
import { BackupView } from './components/backup/BackupView';

import {
  StudioSettings,
  Equipment,
  RecurringExpense,
  ExpenseCatalogItem,
  Professional,
  ProductionTemplate,
  Budget,
} from './types';
import { api } from './api/client';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [expenseCatalog, setExpenseCatalog] = useState<ExpenseCatalogItem[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [templates, setTemplates] = useState<ProductionTemplate[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);

  // Orçamento atualmente em edição
  const [editingBudget, setEditingBudget] = useState<Partial<Budget> | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Carregar todos os dados do banco local
  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const [
        loadedSettings,
        loadedEquipment,
        loadedRecurring,
        loadedCatalog,
        loadedPros,
        loadedTemplates,
        loadedBudgets,
      ] = await Promise.all([
        api.getSettings(),
        api.getEquipment(),
        api.getRecurringExpenses(),
        api.getExpenseCatalog(),
        api.getProfessionals(),
        api.getTemplates(),
        api.getBudgets(),
      ]);

      setSettings(loadedSettings);
      setEquipment(loadedEquipment);
      setRecurringExpenses(loadedRecurring);
      setExpenseCatalog(loadedCatalog);
      setProfessionals(loadedPros);
      setTemplates(loadedTemplates);
      setBudgets(loadedBudgets);
    } catch (err: any) {
      console.error('Erro ao carregar dados:', err);
      setLoadError(err.message || 'Falha ao conectar com o banco de dados local.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Ações de Navegação
  const handleNavigate = (view: ActiveView) => {
    if (view === 'new_budget') {
      handleCreateNewBudget();
    } else {
      setActiveView(view);
    }
  };

  const handleCreateNewBudget = () => {
    const year = new Date().getFullYear();
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    setEditingBudget({
      title: 'Novo Orçamento Audiovisual',
      code: `ORC-${year}-${randomCode}`,
      client_name: '',
      client_company: '',
      client_email: '',
      client_phone: '',
      description: '',
      scope_summary: '',
      internal_notes: '',
      responsible: settings?.studio_name || 'FBonilha',
      status: 'draft',
      stages: [
        { id: 's1', name: 'Planejamento e Roteiro', hours: 4, hourlyRate: settings?.default_hourly_rate || 150, commercialGroup: 'pre', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's2', name: 'Captação Principal', hours: 8, hourlyRate: settings?.default_hourly_rate || 150, commercialGroup: 'prod', isProfessionalLabor: true, isOverheadEligible: true },
        { id: 's3', name: 'Edição, Cor e Finalização', hours: 12, hourlyRate: settings?.default_hourly_rate || 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
      ],
      equipment: [],
      professionals: [],
      expenses: [],
      pricingConfig: {
        method: settings?.default_pricing_method || 'margin_on_sale',
        desiredProfitMarginPct: settings?.default_profit_margin_pct || 25,
        desiredMarkupPct: settings?.default_markup_pct || 35,
        taxPct: settings?.default_tax_pct || 6,
        financialFeePct: settings?.default_financial_fee_pct || 2.5,
        fixedTransactionFee: settings?.default_fixed_fee || 0,
        customPriceOverride: null,
        cashDiscountPct: settings?.default_cash_discount_pct || 10,
        installmentCount: settings?.default_installments || 4,
      },
    });
    setActiveView('budget_editor');
  };

  const handleOpenBudget = (id: string) => {
    const target = budgets.find((b) => b.id === id);
    if (target) {
      setEditingBudget(target);
      setActiveView('budget_editor');
    }
  };

  const handleUseTemplate = (tpl: ProductionTemplate) => {
    const year = new Date().getFullYear();
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    setEditingBudget({
      title: `${tpl.name} - Projeto`,
      code: `ORC-${year}-${randomCode}`,
      client_name: '',
      template_id: tpl.id,
      stages: JSON.parse(JSON.stringify(tpl.stages || [])),
      equipment: JSON.parse(JSON.stringify(tpl.equipment || [])),
      professionals: JSON.parse(JSON.stringify(tpl.professionals || [])),
      expenses: JSON.parse(JSON.stringify(tpl.expenses || [])),
      pricingConfig: {
        method: tpl.pricingConfig?.method || settings?.default_pricing_method || 'margin_on_sale',
        desiredProfitMarginPct: tpl.pricingConfig?.desiredProfitMarginPct ?? settings?.default_profit_margin_pct ?? 25,
        desiredMarkupPct: tpl.pricingConfig?.desiredMarkupPct ?? settings?.default_markup_pct ?? 35,
        taxPct: tpl.pricingConfig?.taxPct ?? settings?.default_tax_pct ?? 6,
        financialFeePct: tpl.pricingConfig?.financialFeePct ?? settings?.default_financial_fee_pct ?? 2.5,
        fixedTransactionFee: tpl.pricingConfig?.fixedTransactionFee ?? settings?.default_fixed_fee ?? 0,
        customPriceOverride: null,
        cashDiscountPct: tpl.pricingConfig?.cashDiscountPct ?? settings?.default_cash_discount_pct ?? 10,
        installmentCount: tpl.pricingConfig?.installmentCount ?? settings?.default_installments ?? 4,
      },
      status: 'draft',
      responsible: settings?.studio_name || 'FBonilha',
    });
    setActiveView('budget_editor');
  };

  // Handlers de Persistência via API
  const handleSaveBudget = async (budgetData: Partial<Budget>): Promise<Budget> => {
    let saved: Budget;
    if (budgetData.id) {
      saved = await api.updateBudget(budgetData.id, budgetData);
    } else {
      saved = await api.createBudget(budgetData);
    }
    await loadAllData();
    return saved;
  };

  const handleEmitProposal = async (budgetId: string, payload: any) => {
    await api.emitProposal(budgetId, payload);
    await loadAllData();
  };

  const handleCloneBudget = async (id: string) => {
    await api.cloneBudget(id);
    await loadAllData();
  };

  const handleDeleteBudget = async (id: string) => {
    await api.deleteBudget(id);
    await loadAllData();
  };

  // Handlers Equipamentos
  const handleSaveEquipment = async (data: Partial<Equipment>) => {
    if (data.id) {
      await api.updateEquipment(data.id, data);
    } else {
      await api.createEquipment(data);
    }
    const updated = await api.getEquipment();
    setEquipment(updated);
  };

  const handleDeleteEquipment = async (id: string) => {
    await api.deleteEquipment(id);
    const updated = await api.getEquipment();
    setEquipment(updated);
  };

  // Handlers Custos Fixos
  const handleSaveRecurring = async (data: Partial<RecurringExpense>) => {
    if (data.id) {
      await api.updateRecurringExpense(data.id, data);
    } else {
      await api.createRecurringExpense(data);
    }
    const updated = await api.getRecurringExpenses();
    setRecurringExpenses(updated);
  };

  const handleDeleteRecurring = async (id: string) => {
    await api.deleteRecurringExpense(id);
    const updated = await api.getRecurringExpenses();
    setRecurringExpenses(updated);
  };

  // Handlers Catálogo de Despesas
  const handleSaveCatalog = async (data: Partial<ExpenseCatalogItem>) => {
    if (data.id) {
      await api.updateExpenseCatalogItem(data.id, data);
    } else {
      await api.createExpenseCatalogItem(data);
    }
    const updated = await api.getExpenseCatalog();
    setExpenseCatalog(updated);
  };

  const handleDeleteCatalog = async (id: string) => {
    await api.deleteExpenseCatalogItem(id);
    const updated = await api.getExpenseCatalog();
    setExpenseCatalog(updated);
  };

  // Handlers Profissionais
  const handleSaveProfessional = async (data: Partial<Professional>) => {
    if (data.id) {
      await api.updateProfessional(data.id, data);
    } else {
      await api.createProfessional(data);
    }
    const updated = await api.getProfessionals();
    setProfessionals(updated);
  };

  const handleDeleteProfessional = async (id: string) => {
    await api.deleteProfessional(id);
    const updated = await api.getProfessionals();
    setProfessionals(updated);
  };

  // Handlers Modelos
  const handleCloneTemplate = async (id: string) => {
    await api.cloneTemplate(id);
    const updated = await api.getTemplates();
    setTemplates(updated);
  };

  const handleDeleteTemplate = async (id: string) => {
    await api.deleteTemplate(id);
    const updated = await api.getTemplates();
    setTemplates(updated);
  };

  // Handlers Configurações
  const handleSaveSettings = async (data: Partial<StudioSettings>) => {
    const updated = await api.updateSettings(data);
    setSettings(updated);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white font-bold flex items-center justify-center mx-auto animate-pulse">
            FB
          </div>
          <p className="text-sm font-semibold text-slate-800">
            Conectando ao banco de dados SQLite local...
          </p>
          <p className="text-xs text-slate-400">FBonilha Audiovisual</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md bg-white border border-red-200 rounded-xl p-6 text-center space-y-4 shadow-sm">
          <h3 className="text-base font-bold text-red-900">Falha ao Inicializar o Banco Local</h3>
          <p className="text-xs text-red-700">{loadError}</p>
          <button
            onClick={loadAllData}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 transition-colors"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar de Navegação */}
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        settings={settings}
        savedBudgetsCount={budgets.length}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Área Central de Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeView={activeView}
          onNavigate={handleNavigate}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          title={activeView === 'budget_editor' ? editingBudget?.title : undefined}
        />

        <main className="flex-1 p-6 sm:p-8 overflow-y-auto">
          {activeView === 'dashboard' && (
            <DashboardView
              budgets={budgets}
              equipment={equipment}
              settings={settings}
              onNavigate={handleNavigate}
              onOpenBudget={handleOpenBudget}
            />
          )}

          {activeView === 'budget_editor' && editingBudget && (
            <BudgetEditorView
              initialBudget={editingBudget}
              equipmentCatalog={equipment}
              recurringExpenses={recurringExpenses}
              expenseCatalog={expenseCatalog}
              professionalsCatalog={professionals}
              templates={templates}
              settings={settings}
              onSaveBudget={handleSaveBudget}
              onEmitProposal={handleEmitProposal}
              onBack={() => setActiveView('budgets_list')}
            />
          )}

          {activeView === 'budgets_list' && (
            <BudgetListView
              budgets={budgets}
              settings={settings}
              onOpenBudget={handleOpenBudget}
              onNewBudget={handleCreateNewBudget}
              onCloneBudget={handleCloneBudget}
              onDeleteBudget={handleDeleteBudget}
            />
          )}

          {activeView === 'equipment' && (
            <EquipmentView
              equipmentList={equipment}
              onSave={handleSaveEquipment}
              onDelete={handleDeleteEquipment}
            />
          )}

          {activeView === 'fixed_expenses' && (
            <FixedExpensesView
              expenses={recurringExpenses}
              settings={settings}
              onSaveExpense={handleSaveRecurring}
              onDeleteExpense={handleDeleteRecurring}
              onUpdateSettings={handleSaveSettings}
            />
          )}

          {activeView === 'catalog' && (
            <ExpenseCatalogView
              catalog={expenseCatalog}
              onSaveItem={handleSaveCatalog}
              onDeleteItem={handleDeleteCatalog}
            />
          )}

          {activeView === 'professionals' && (
            <ProfessionalsView
              professionals={professionals}
              onSaveProfessional={handleSaveProfessional}
              onDeleteProfessional={handleDeleteProfessional}
            />
          )}

          {activeView === 'templates' && (
            <TemplatesView
              templates={templates}
              onUseTemplate={handleUseTemplate}
              onCloneTemplate={handleCloneTemplate}
              onDeleteTemplate={handleDeleteTemplate}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView settings={settings} onSaveSettings={handleSaveSettings} />
          )}

          {activeView === 'backup' && <BackupView onRefreshAllData={loadAllData} />}
        </main>
      </div>
    </div>
  );
}
