import {
  StudioSettings,
  Equipment,
  RecurringExpense,
  ExpenseCatalogItem,
  Professional,
  ProductionTemplate,
  Budget,
  ProposalSnapshot,
} from '../types';

const BASE_URL = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Erro na requisição: ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  // Configurações
  getSettings: () => fetch(`${BASE_URL}/settings`).then((r) => handleResponse<StudioSettings>(r)),
  updateSettings: (data: Partial<StudioSettings>) =>
    fetch(`${BASE_URL}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<StudioSettings>(r)),

  // Equipamentos
  getEquipment: () => fetch(`${BASE_URL}/equipment`).then((r) => handleResponse<Equipment[]>(r)),
  createEquipment: (data: Partial<Equipment>) =>
    fetch(`${BASE_URL}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Equipment>(r)),
  updateEquipment: (id: string, data: Partial<Equipment>) =>
    fetch(`${BASE_URL}/equipment/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Equipment>(r)),
  deleteEquipment: (id: string) =>
    fetch(`${BASE_URL}/equipment/${id}`, { method: 'DELETE' }).then((r) => handleResponse<{ success: boolean }>(r)),

  // Custos Fixos Mensais
  getRecurringExpenses: () =>
    fetch(`${BASE_URL}/recurring-expenses`).then((r) => handleResponse<RecurringExpense[]>(r)),
  createRecurringExpense: (data: Partial<RecurringExpense>) =>
    fetch(`${BASE_URL}/recurring-expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<RecurringExpense>(r)),
  updateRecurringExpense: (id: string, data: Partial<RecurringExpense>) =>
    fetch(`${BASE_URL}/recurring-expenses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<RecurringExpense>(r)),
  deleteRecurringExpense: (id: string) =>
    fetch(`${BASE_URL}/recurring-expenses/${id}`, { method: 'DELETE' }).then((r) => handleResponse<{ success: boolean }>(r)),

  // Catálogo de Despesas Extras
  getExpenseCatalog: () =>
    fetch(`${BASE_URL}/expense-catalog`).then((r) => handleResponse<ExpenseCatalogItem[]>(r)),
  createExpenseCatalogItem: (data: Partial<ExpenseCatalogItem>) =>
    fetch(`${BASE_URL}/expense-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<ExpenseCatalogItem>(r)),
  updateExpenseCatalogItem: (id: string, data: Partial<ExpenseCatalogItem>) =>
    fetch(`${BASE_URL}/expense-catalog/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<ExpenseCatalogItem>(r)),
  deleteExpenseCatalogItem: (id: string) =>
    fetch(`${BASE_URL}/expense-catalog/${id}`, { method: 'DELETE' }).then((r) => handleResponse<{ success: boolean }>(r)),

  // Profissionais
  getProfessionals: () =>
    fetch(`${BASE_URL}/professionals`).then((r) => handleResponse<Professional[]>(r)),
  createProfessional: (data: Partial<Professional>) =>
    fetch(`${BASE_URL}/professionals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Professional>(r)),
  updateProfessional: (id: string, data: Partial<Professional>) =>
    fetch(`${BASE_URL}/professionals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Professional>(r)),
  deleteProfessional: (id: string) =>
    fetch(`${BASE_URL}/professionals/${id}`, { method: 'DELETE' }).then((r) => handleResponse<{ success: boolean }>(r)),

  // Modelos de Produção
  getTemplates: () => fetch(`${BASE_URL}/templates`).then((r) => handleResponse<ProductionTemplate[]>(r)),
  createTemplate: (data: Partial<ProductionTemplate>) =>
    fetch(`${BASE_URL}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<ProductionTemplate>(r)),
  updateTemplate: (id: string, data: Partial<ProductionTemplate>) =>
    fetch(`${BASE_URL}/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<ProductionTemplate>(r)),
  cloneTemplate: (id: string) =>
    fetch(`${BASE_URL}/templates/${id}/clone`, { method: 'POST' }).then((r) => handleResponse<ProductionTemplate>(r)),
  deleteTemplate: (id: string) =>
    fetch(`${BASE_URL}/templates/${id}`, { method: 'DELETE' }).then((r) => handleResponse<{ success: boolean }>(r)),

  // Orçamentos
  getBudgets: () => fetch(`${BASE_URL}/budgets`).then((r) => handleResponse<Budget[]>(r)),
  getBudget: (id: string) => fetch(`${BASE_URL}/budgets/${id}`).then((r) => handleResponse<Budget>(r)),
  createBudget: (data: Partial<Budget>) =>
    fetch(`${BASE_URL}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Budget>(r)),
  updateBudget: (id: string, data: Partial<Budget>) =>
    fetch(`${BASE_URL}/budgets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Budget>(r)),
  cloneBudget: (id: string) =>
    fetch(`${BASE_URL}/budgets/${id}/clone`, { method: 'POST' }).then((r) => handleResponse<Budget>(r)),
  deleteBudget: (id: string) =>
    fetch(`${BASE_URL}/budgets/${id}`, { method: 'DELETE' }).then((r) => handleResponse<{ success: boolean }>(r)),
  emitProposal: (budgetId: string, payload: any) =>
    fetch(`${BASE_URL}/budgets/${budgetId}/emit-proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<ProposalSnapshot>(r)),
  getProposals: () => fetch(`${BASE_URL}/proposals`).then((r) => handleResponse<ProposalSnapshot[]>(r)),
  getBudgetProposals: (budgetId: string) =>
    fetch(`${BASE_URL}/budgets/${budgetId}/proposals`).then((r) => handleResponse<ProposalSnapshot[]>(r)),
  getProposal: (id: string) =>
    fetch(`${BASE_URL}/proposals/${id}`).then((r) => handleResponse<ProposalSnapshot>(r)),

  // Gestão de Demonstração
  listSampleData: () =>
    fetch(`${BASE_URL}/demo/samples`).then((r) =>
      handleResponse<{ samples: Array<{ table: string; categoryLabel: string; id: string; name: string }>; count: number }>(r)
    ),
  clearSampleData: () =>
    fetch(`${BASE_URL}/demo/clear-samples`, { method: 'POST' }).then((r) => handleResponse<{ success: boolean; message: string }>(r)),
  restoreSampleData: () =>
    fetch(`${BASE_URL}/demo/restore-samples`, { method: 'POST' }).then((r) => handleResponse<{ success: boolean; message: string }>(r)),

  // Backup & Restauração
  exportBackupJsonUrl: () => `${BASE_URL}/backup/export-json`,
  exportBackupSqliteUrl: () => `${BASE_URL}/backup/export-sqlite`,
  importBackupJson: (data: any, mode: 'preview' | 'commit' = 'preview', restoreMode: 'replace' | 'merge' = 'replace') =>
    fetch(`${BASE_URL}/backup/import-json?mode=${mode}&restoreMode=${restoreMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<any>(r)),
};
